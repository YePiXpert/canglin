import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { config } from '../config';
import type { AiConfigInput, AiConfigView, ReasoningSetting } from '@canglin/shared';
import type { ChatCallOptions, RejectableParam } from './llm.client';

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
}
/** 调用用途：决定「自动」推理强度。识别与审核 low，问答 medium，搜索与能力检测不发 */
export type CallPurpose = 'import' | 'ask' | 'search';
const AUTO_EFFORT: Record<CallPurpose, ChatCallOptions['reasoningEffort']> = { import: 'low', ask: 'medium', search: undefined };
export type Capabilities = NonNullable<AiConfigView['capabilities']> & { fingerprint: string };
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
    const effort = cfg.reasoningEffort === 'auto' || !cfg.reasoningEffort ? AUTO_EFFORT[purpose] : cfg.reasoningEffort;
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
  async saveCapabilities(cfg: StoredAiConfig, values: Omit<Capabilities, 'fingerprint'>) {
    // A fresh capability check also re-learns which request parameters the service accepts.
    await this.prisma.setting.deleteMany({ where: { key: 'aiParamSupport' } });
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
    const current = await this.getConfig();
    const stored: StoredAiConfig = {
      ...current,
      ...input,
      protocol: 'responses',
      apiKey: config.llmDefaults.apiKey || input.apiKey || current.apiKey,
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
    return {
      ...rest,
      apiKeySet: !!apiKey,
      keySource: config.llmDefaults.apiKey ? 'server' : 'database',
      capabilities: caps
        ? {
            checkedAt: caps.checkedAt,
            text: caps.text,
            image: caps.image,
            structured: caps.structured,
            tools: caps.tools,
          }
        : undefined,
    };
  }
}
