function removeNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeNulls);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, removeNulls(v)]),
    );
  return value;
}
import { BadRequestException, Injectable } from '@nestjs/common';
import { type AiAskInput, type AiAskResponse, type AiToolStep } from '@canglin/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LlmClient, type ChatMessage } from './llm.client';
import { AiConfigService, type StoredAiConfig } from './ai-config.service';
import { AiToolsService } from './ai-tools';

/** 单条工具结果回传给 LLM 的字符上限，防止 token 失控 */
const TOOL_RESULT_LIMIT = 16_000;
const MAX_TOOL_ROUNDS = 6;
const MAX_LINES = 20;
const DROPPED_KEYS = new Set(['createdAt', 'updatedAt', 'createdBy', 'updatedBy']);
/** 金额、价格、数量的 null 表示「未知」（提示词规则 4），不能当空值删掉 */
const MEANINGFUL_NULL = /amount|price|quantity/i;

/**
 * 工具结果回传前精简，替代按字符截断（截断会给模型残缺的 JSON）：去掉空值与时间戳，附件只留「类型:文件名」，
 * 每张单据或申请最多 20 行（linesTruncated）；仍超限时从末尾删条目并标记 truncated 与 hint。返回值总是合法 JSON。
 */
export function compactToolResult(value: unknown, limit = TOOL_RESULT_LIMIT): string {
  const slim = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(slim);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(node)) {
      if (DROPPED_KEYS.has(key) || raw === '' || (Array.isArray(raw) && !raw.length)) continue;
      if (raw === null) {
        if (MEANINGFUL_NULL.test(key)) out[key] = null;
        continue;
      }
      if (key === 'attachments' && Array.isArray(raw)) {
        out.attachments = raw.map((a: { kind?: string; filename?: string }) => `${a.kind}:${a.filename}`);
      } else if (key === 'lines' && Array.isArray(raw) && raw.length > MAX_LINES) {
        out.lines = raw.slice(0, MAX_LINES).map(slim);
        out.linesTruncated = true;
      } else out[key] = slim(raw);
    }
    return out;
  };
  const compact = slim(value);
  if (JSON.stringify(compact).length <= limit) return JSON.stringify(compact);
  const result = (Array.isArray(compact) ? { items: compact } : compact) as Record<string, unknown>;
  const key = ['items', 'products'].find((k) => Array.isArray(result[k]));
  if (key) {
    Object.assign(result, { truncated: true, hint: '缩小日期范围或减少 pageSize' });
    const list = result[key] as unknown[];
    while (list.length && JSON.stringify(result).length > limit) list.pop();
  }
  const json = JSON.stringify(result);
  return json.length <= limit
    ? json
    : JSON.stringify({ truncated: true, hint: '结果过大，请缩小日期范围或指定物品、供应商后再查' });
}

@Injectable()
export class AiService {
  constructor(
    private readonly llm: LlmClient,
    private readonly aiConfig: AiConfigService,
    private readonly tools: AiToolsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 门槛检查放在最前面，未启用时给出可操作的提示 */
  private async requireConfig(): Promise<StoredAiConfig> {
    const cfg = await this.aiConfig.getConfig();
    if (!(cfg.enabled && cfg.apiKey)) {
      throw new BadRequestException('AI 功能未启用，请先到「系统设置 → AI 助手」完成配置');
    }
    return cfg;
  }

  /** 自然语言问答：tool-calling 循环最多 MAX_TOOL_ROUNDS 轮，之后强制收敛为最终回答 */
  async ask(input: AiAskInput, ip?: string): Promise<AiAskResponse> {
    const cfg = await this.requireConfig();
    const capabilities = await this.aiConfig.capabilities(cfg);
    if (capabilities && !capabilities.tools)
      throw new BadRequestException('当前服务未通过工具调用检测，业务问答不可用');
    const messages: ChatMessage[] = [
      { role: 'system', content: this.tools.systemPrompt() },
      ...(input.history ?? []).map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: input.question },
    ];
    const defs = this.tools.definitions();
    const steps: AiToolStep[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await this.llm.chat({
        ...(await this.aiConfig.params(cfg, 'ask')),
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        messages,
        tools: defs,
        maxTokens: 2048,
      });

      if (res.toolCalls.length === 0) {
        await this.audit.log('AI_QUERY', {
          detail: { question: input.question, rounds: round + 1, toolCalls: steps.length },
          ip,
        });
        return {
          answer: res.content?.trim() || '（模型没有返回内容，请重试）',
          steps,
          model: cfg.model,
        };
      }

      messages.push({
        role: 'assistant',
        content: res.content,
        responseItems: res.outputItems,
        tool_calls: res.toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
        })),
      });
      for (const call of res.toolCalls) {
        let payload: string;
        let count = 0;
        try {
          const executed = await this.tools.execute(
            call.name,
            removeNulls(call.args ?? {}) as Record<string, unknown>,
          );
          count = executed.count;
          payload = compactToolResult(executed.result);
        } catch (e) {
          // 工具报错也回给模型，让它自行调整参数或放弃该路径
          payload = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
        }
        steps.push({
          name: call.name,
          args: removeNulls(call.args ?? {}) as Record<string, unknown>,
          count,
        });
        messages.push({ role: 'tool', content: payload, tool_call_id: call.id });
      }
    }

    const final = await this.llm.chat({
      ...(await this.aiConfig.params(cfg, 'ask')),
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages,
      maxTokens: 2048,
    });
    await this.audit.log('AI_QUERY', {
      detail: { question: input.question, rounds: MAX_TOOL_ROUNDS + 1, toolCalls: steps.length },
      ip,
    });
    return {
      answer: final.content?.trim() || '（多轮查询后未能生成回答，请换个问法重试）',
      steps,
      model: cfg.model,
    };
  }
}
