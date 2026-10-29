import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { config } from '../config';
import type { AiConfigInput, AiConfigView, AiEffortSupport, ReasoningLevel, ReasoningSetting } from '@canglin/shared';
import type { ChatCallOptions, EffortProbe, RejectableParam } from './llm.client';

export interface StoredAiConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  semanticSearch: boolean;
  protocol: 'responses';
  autoImport: boolean;
  inputPrice: number | null;
  outputPrice: number | null;
  monthlyBudget: number | null;
  reasoningEffort: ReasoningSetting;
  reviewTextPdf: boolean;
}
/** 调用用途：决定「自动」推理强度。识别与审核 low，问答 medium，搜索与能力检测不发 */
export type CallPurpose = 'import' | 'ask' | 'search';
const AUTO_EFFORT: Record<CallPurpose, ChatCallOptions['reasoningEffort']> = { import: 'low', ask: 'medium', search: undefined };
export type Capabilities = NonNullable<AiConfigView['capabilities']> & { fingerprint: string };
/** 服务商确认过的模型推理档位：按「接口地址 + 密钥 + 模型」的哈希记在 aiEffortSupport 设置里，最多留最近 20 个模型 */
type StoredEffortSupport = Pick<AiEffortSupport, 'supported' | 'defaultEffort' | 'reasoningParam' | 'checkedAt'> & { supported: ReasoningLevel[] };
const EFFORT_SUPPORT_LIMIT = 20;
@Injectable()
export class AiConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private defaults(): StoredAiConfig {
    return {
      enabled: false,
      ...config.llmDefaults,
      semanticSearch: true,
      protocol: 'responses',
      autoImport: false,
      inputPrice: null,
      outputPrice: null,
      monthlyBudget: null,
      reasoningEffort: 'auto',
      reviewTextPdf: true,
    };
  }
  async getConfig(): Promise<StoredAiConfig> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'aiConfig' } });
    let stored = {};
    try {
      stored = row ? JSON.parse(row.value) : {};
    } catch {
      /* corrupt config stays disabled */
    }
    const result = { ...this.defaults(), ...stored };
    // Ignore legacy overrides immediately, including when loading an old backup.
    for (const key of ['importModel', 'askModel', 'searchModel'])
      Reflect.deleteProperty(result, key);
    if (config.llmDefaults.apiKey) result.apiKey = config.llmDefaults.apiKey;
    return result;
  }
  fingerprint(cfg: StoredAiConfig) {
    // Keep empty legacy slots so existing single-model capability checks stay valid.
    return createHash('sha256')
      .update(JSON.stringify([cfg.baseUrl, cfg.apiKey, cfg.model, '', '', '', 'responses']))
      .digest('hex');
  }
  async capabilities(cfg: StoredAiConfig): Promise<Capabilities | undefined> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'aiCapabilities' } });
    if (!row) return;
    const value = JSON.parse(row.value) as Capabilities;
    return value.fingerprint === this.fingerprint(cfg) ? value : undefined;
  }
  /**
   * 本次调用可发送的 temperature / reasoning：按设置与用途取值，跳过当前服务（按配置指纹）拒绝过的参数；
   * onRejected 记下新被拒的参数，之后不再发送。
   */
  async params(cfg: StoredAiConfig, purpose: CallPurpose, temperature?: number): Promise<Partial<ChatCallOptions>> {
    if (cfg.reasoningEffort === 'off') return {};
    const row = await this.prisma.setting.findUnique({ where: { key: 'aiParamSupport' } });
    const stored = row ? (JSON.parse(row.value) as { fingerprint: string; rejected: RejectableParam[] }) : undefined;
    const rejected = stored?.fingerprint === this.fingerprint(cfg) ? stored.rejected : [];
    // 搜索只有 512 个输出 token，带推理容易截断后静默失效：固定强度也只用于识别、审核与问答
    const effort = purpose === 'search' ? undefined
      : cfg.reasoningEffort === 'auto' || !cfg.reasoningEffort ? AUTO_EFFORT[purpose] : cfg.reasoningEffort;
    return {
      ...(effort && !rejected.includes('reasoning') ? { reasoningEffort: effort } : {}),
      ...(temperature != null && !rejected.includes('temperature') ? { temperature } : {}),
      onRejected: async (params) => {
        const value = { fingerprint: this.fingerprint(cfg), rejected: [...new Set([...rejected, ...params])] };
        await this.prisma.setting.upsert({
          where: { key: 'aiParamSupport' },
          create: { key: 'aiParamSupport', value: JSON.stringify(value) },
          update: { value: JSON.stringify(value) },
        });
      },
    };
  }
  /** 检测连接开始时忘掉服务拒绝过的参数：这一轮检测重新学，学到的保留给之后的调用 */
  async forgetRejectedParams() {
    await this.prisma.setting.deleteMany({ where: { key: 'aiParamSupport' } });
  }
  private effortKey(cfg: StoredAiConfig, model: string) {
    return createHash('sha256').update(JSON.stringify([cfg.baseUrl, cfg.apiKey, model])).digest('hex');
  }
  private async effortSupportMap(): Promise<Record<string, StoredEffortSupport>> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'aiEffortSupport' } });
    try {
      return row ? (JSON.parse(row.value) as Record<string, StoredEffortSupport>) : {};
    } catch {
      return {};
    }
  }
  /** 这个模型在当前服务上确认过的档位；没确认过（或换了地址、密钥）为 undefined */
  async effortSupport(cfg: StoredAiConfig, model: string): Promise<AiEffortSupport | undefined> {
    const hit = (await this.effortSupportMap())[this.effortKey(cfg, model)];
    return hit ? { model, ...hit } : undefined;
  }
  /** 记下探测结果并返回设置页用的视图；没能确认的不记，下次再探 */
  async saveEffortSupport(cfg: StoredAiConfig, model: string, probe: EffortProbe): Promise<AiEffortSupport> {
    const checkedAt = new Date().toISOString();
    if (!probe.supported)
      return { model, supported: null, defaultEffort: null, reasoningParam: true, checkedAt, ...(probe.detail ? { detail: probe.detail } : {}) };
    const entry: StoredEffortSupport = { supported: probe.supported, defaultEffort: probe.defaultEffort, reasoningParam: probe.reasoningParam, checkedAt };
    const map = await this.effortSupportMap();
    const key = this.effortKey(cfg, model);
    delete map[key];
    map[key] = entry;
    for (const stale of Object.keys(map).slice(0, Math.max(0, Object.keys(map).length - EFFORT_SUPPORT_LIMIT))) delete map[stale];
    await this.prisma.setting.upsert({
      where: { key: 'aiEffortSupport' },
      create: { key: 'aiEffortSupport', value: JSON.stringify(map) },
      update: { value: JSON.stringify(map) },
    });
    return { model, ...entry };
  }
  async saveCapabilities(cfg: StoredAiConfig, values: Omit<Capabilities, 'fingerprint'>) {
    const result = {
      ...values,
      fingerprint: this.fingerprint(cfg),
      baseUrl: cfg.baseUrl,
      models: {
        text: cfg.model,
        import: cfg.model,
        ask: cfg.model,
        search: cfg.model,
      },
    };
    await this.prisma.setting.upsert({
      where: { key: 'aiCapabilities' },
      create: { key: 'aiCapabilities', value: JSON.stringify(result) },
      update: { value: JSON.stringify(result) },
    });
    return result;
  }
  async updateConfig(input: AiConfigInput, ip?: string) {
    // 允许列表只拦启用状态的保存：列表收窄后库里的旧模型可能已不在列表里，关闭 AI 助手或改别的设置仍要能保存
    const allowed = config.llmAllowedModels;
    if (input.enabled && allowed && !allowed.some((m) => m.id === input.model))
      throw new BadRequestException(`模型不在允许列表中，请选择 ${allowed.map((m) => m.id).join('、')}`);
    const current = await this.getConfig();
    const stored: StoredAiConfig = {
      ...current,
      ...input,
      protocol: 'responses',
      apiKey: config.llmDefaults.apiKey || input.apiKey || current.apiKey,
      // 没提交强度时：同一个模型沿用原值，换了模型回到「自动」
      reasoningEffort: input.reasoningEffort ?? (input.model === current.model ? current.reasoningEffort : 'auto'),
    };
    if (stored.enabled && !stored.apiKey) throw new BadRequestException('请先配置 API Key');
    if (stored.enabled && stored.autoImport) {
      const caps = await this.capabilities(stored);
      if (!caps?.image || !caps.structured)
        throw new BadRequestException(
          '请先保存配置并通过图像、结构化输出能力检测，再开启自动智能导入',
        );
    }
    // Server-managed secrets must never be copied into the database or backups.
    const persisted = { ...stored, apiKey: config.llmDefaults.apiKey ? '' : stored.apiKey };
    await this.prisma.setting.upsert({
      where: { key: 'aiConfig' },
      create: { key: 'aiConfig', value: JSON.stringify(persisted) },
      update: { value: JSON.stringify(persisted) },
    });
    await this.audit.log('AI_CONFIG_UPDATE', {
      detail: { enabled: stored.enabled, baseUrl: stored.baseUrl, model: stored.model },
      ip,
    });
    return stored;
  }
  async isReady() {
    const c = await this.getConfig();
    return c.enabled && !!c.apiKey;
  }
  async semanticSearchEnabled() {
    const c = await this.getConfig();
    return c.enabled && c.semanticSearch && !!c.apiKey;
  }
  async canImport(cfg: StoredAiConfig) {
    const caps = await this.capabilities(cfg);
    return cfg.enabled && cfg.autoImport && !!cfg.apiKey && !!caps?.image && !!caps.structured;
  }
  async view(cfg: StoredAiConfig): Promise<AiConfigView> {
    const { apiKey, ...rest } = cfg;
    const caps = await this.capabilities(cfg);
    const effortSupport = apiKey ? await this.effortSupport(cfg, cfg.model) : undefined;
    return {
      ...rest,
      apiKeySet: !!apiKey,
      keySource: config.llmDefaults.apiKey ? 'server' : 'database',
      models: config.llmAllowedModels,
      ...(effortSupport ? { effortSupport } : {}),
      capabilities: caps
        ? {
            checkedAt: caps.checkedAt,
            text: caps.text,
            image: caps.image,
            structured: caps.structured,
            tools: caps.tools,
            ...(caps.detail ? { detail: caps.detail } : {}),
          }
        : undefined,
    };
  }
}
