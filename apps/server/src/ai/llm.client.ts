import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type {
  ResponseInput,
  ResponseOutputItem,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';
import type { ReasoningLevel } from '@canglin/shared';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** data URL；同一条用户消息里的多张图按顺序发送（长截图分段） */
  images?: string[];
  responseItems?: ResponseOutputItem[];
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}
export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface ChatCallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  jsonMode?: boolean;
  schema?: Record<string, unknown>;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  /** 服务以 400 拒绝 temperature / reasoning 时，去掉后重发一次，并把被拒的参数告诉调用方 */
  onRejected?: (params: RejectableParam[]) => Promise<void> | void;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export type ReasoningEffort = ReasoningLevel;
export type RejectableParam = 'temperature' | 'reasoning';
export interface ChatCompletionResult {
  content: string | null;
  toolCalls: { id: string; name: string; args: unknown }[];
  outputItems?: ResponseOutputItem[];
  usage?: { input: number; output: number };
  requestId?: string;
}
type CallMetadata = Pick<ChatCompletionResult, 'usage' | 'requestId'> & { incompleteReason?: string };
export class AiResponseError extends ServiceUnavailableException {
  constructor(
    message: string,
    readonly kind: string,
    readonly metadata?: CallMetadata,
  ) {
    super(message);
  }
}
/** 400 的报错里点名了这个参数（OpenAI 写在 param 与 message，第三方服务多半只写在 message） */
function mentions(error: InstanceType<typeof OpenAI.APIError>, param: RejectableParam) {
  return [error.message, error.param, JSON.stringify(error.error ?? '')].join(' ').toLowerCase().includes(param);
}
/**
 * 400 说的是 reasoning.effort 这个值不被模型接受（OpenAI 给 code unsupported_value，如 GPT-6.1 Sol 不接受 none），
 * 不是整个参数不支持：这是设置问题，要报出来让人换档，不能当成参数被拒而悄悄去掉推理。
 */
function unsupportedEffort(error: InstanceType<typeof OpenAI.APIError>, effort: ReasoningLevel) {
  if (!mentions(error, 'reasoning')) return false;
  const text = [error.message, JSON.stringify(error.error ?? '')].join(' ');
  if (/unsupported parameter/i.test(text)) return false;
  return error.code === 'unsupported_value' || /unsupported value|invalid value|supported values/i.test(text) || new RegExp(`['"\`]${effort}['"\`]`).test(text);
}
/** 推理 token 也计入 max_output_tokens：高档位另留预算，免得想得多就把回答截断；低、中档位沿用调用方的预算 */
const REASONING_RESERVE: Partial<Record<ReasoningLevel, number>> = { high: 8_000, xhigh: 16_000, max: 32_000 };
const reasoningReserve = (effort?: ReasoningLevel) => (effort && REASONING_RESERVE[effort]) || 0;
/** Strict output contracts require all properties; formerly optional fields become nullable. */
export function strictSchema(raw: Record<string, unknown>): Record<string, unknown> {
  const schema = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  delete schema.$schema;
  function walk(node: Record<string, unknown>) {
    // zod 的 .default() 会带上 default：严格模式的服务商不一定接受这个关键字，缺字段时的默认值由服务端解析补上
    delete node.default;
    if (node.properties) {
      const properties = node.properties as Record<string, Record<string, unknown>>;
      const required = (node.required ?? []) as string[];
      for (const [key, value] of Object.entries(properties)) {
        walk(value);
        if (!required.includes(key)) properties[key] = { anyOf: [value, { type: 'null' }] };
      }
      node.required = Object.keys(properties);
      node.additionalProperties = false;
    }
    if (node.items) walk(node.items as Record<string, unknown>);
    for (const name of ['anyOf', 'oneOf', 'allOf'])
      for (const sub of (node[name] ?? []) as Record<string, unknown>[]) walk(sub);
  }
  walk(schema);
  return schema;
}

@Injectable()
export class LlmClient {
  async listModels(baseUrl: string, apiKey: string): Promise<string[]> {
    try {
      const client = new OpenAI({
        apiKey,
        baseURL: baseUrl.replace(/\/+$/, ''),
        maxRetries: 0,
        timeout: 15_000,
      });
      const page = await client.models.list();
      if (!Array.isArray(page.data) || page.data.some((m) => !m || typeof m.id !== 'string')) {
        throw new Error('Invalid model list');
      }
      return [
        ...new Set(
          page.data
            .map((m) => m.id)
            .filter((id) => id.trim() === id && id.length > 0 && id.length <= 100),
        ),
      ].sort();
    } catch {
      // Provider errors may echo credentials or request headers; never forward them.
      throw new ServiceUnavailableException(
        '无法获取模型列表，请检查已保存的服务地址与密钥，或手动填写模型名',
      );
    }
  }

  async chat(opts: ChatCallOptions): Promise<ChatCompletionResult> {
    const client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl.replace(/\/+$/, ''),
      maxRetries: 0,
      timeout: opts.timeoutMs ?? 120_000,
    });
    const input: ResponseInput = [];
    for (const message of opts.messages) {
      if (message.responseItems) {
        try {
          input.push(...toResponseInputItems(message.responseItems));
        } catch {
          throw new AiResponseError('服务返回了不支持的 Responses 输出条目', 'UNSUPPORTED_OUTPUT');
        }
        continue;
      }
      if (message.role === 'tool') {
        input.push({
          type: 'function_call_output',
          call_id: message.tool_call_id!,
          output: message.content ?? '',
        });
        continue;
      }
      if (message.tool_calls?.length) {
        for (const call of message.tool_calls)
          input.push({
            type: 'function_call',
            call_id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          });
        continue;
      }
      if (message.images?.length)
        input.push({
          role: 'user',
          content: [
            { type: 'input_text', text: message.content ?? '' },
            ...message.images.map((url) => ({ type: 'input_image' as const, image_url: url, detail: 'high' as const })),
          ],
        });
      else input.push({ role: message.role, content: message.content ?? '' });
    }
    const body: ResponseCreateParamsNonStreaming = {
      model: opts.model,
      input,
      store: false,
      max_output_tokens: (opts.maxTokens ?? 4096) + reasoningReserve(opts.reasoningEffort),
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.reasoningEffort ? { reasoning: { effort: opts.reasoningEffort } } : {}),
      ...(opts.tools?.length
        ? {
            tools: opts.tools.map((t) => ({
              type: 'function' as const,
              name: t.function.name,
              description: t.function.description,
              parameters: strictSchema(t.function.parameters),
              strict: true,
            })),
          }
        : {}),
      ...(opts.schema
        ? {
            text: {
              format: {
                type: 'json_schema' as const,
                name: 'result',
                schema: strictSchema(opts.schema),
                strict: true,
              },
            },
          }
        : opts.jsonMode
          ? { text: { format: { type: 'json_object' as const } } }
          : {}),
    };
    const rejected: RejectableParam[] = [];
    let transientRetried = false;
    const report = async () => {
      try {
        if (rejected.length) await opts.onRejected?.(rejected);
      } catch {
        /* remembering a rejected parameter is best effort; the call result matters more */
      }
    };
    for (;;) {
      let metadata: CallMetadata | undefined;
      try {
        const response = await client.responses.create(body, { signal: opts.signal });
        metadata = {
          usage:
            response.usage &&
            Number.isFinite(response.usage.input_tokens) &&
            Number.isFinite(response.usage.output_tokens) &&
            response.usage.input_tokens >= 0 &&
            response.usage.output_tokens >= 0
              ? { input: response.usage.input_tokens, output: response.usage.output_tokens }
              : undefined,
          requestId: response._request_id ?? response.id,
        };
        if (response.status !== 'completed') {
          const reason = response.incomplete_details?.reason;
          throw new AiResponseError(
            response.status !== 'incomplete'
              ? '模型未完成响应'
              : reason === 'max_output_tokens'
                ? '模型输出超过上限，请减少单页行数或拆分页面'
                : '模型输出被截断，请重试或减少单页内容',
            'INCOMPLETE',
            { ...metadata, incompleteReason: reason },
          );
        }
        if (
          response.output.some(
            (i) => i.type === 'message' && i.content.some((c) => c.type === 'refusal'),
          )
        )
          throw new AiResponseError('模型拒绝识别此内容', 'REFUSAL', metadata);
        const toolCalls = response.output
          .filter((i) => i.type === 'function_call')
          .map((i) => ({ id: i.call_id, name: i.name, args: JSON.parse(i.arguments) as unknown }));
        await report();
        return {
          content: response.output_text || null,
          toolCalls,
          outputItems: response.output,
          usage: metadata.usage,
          requestId: response._request_id ?? response.id,
        };
      } catch (error) {
        if (error instanceof AiResponseError) {
          await report();
          throw error;
        }
        if (!rejected.length && error instanceof OpenAI.APIError && error.status === 400) {
          if ('reasoning' in body && opts.reasoningEffort && unsupportedEffort(error, opts.reasoningEffort))
            throw new AiResponseError(`模型 ${opts.model} 不接受推理强度「${opts.reasoningEffort}」，请在系统设置里换一档`, 'UNSUPPORTED_EFFORT');
          const unsupported = (['temperature', 'reasoning'] as const).filter(
            (param) => param in body && mentions(error, param),
          );
          if (unsupported.length) {
            for (const param of unsupported) delete body[param];
            rejected.push(...unsupported);
            continue;
          }
        }
        if (
          !transientRetried &&
          error instanceof OpenAI.APIError &&
          [429, 500, 502, 503].includes(error.status ?? 0)
        ) {
          transientRetried = true;
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        await report();
        const reason =
          error instanceof OpenAI.APIError
            ? `服务返回 ${error.status ?? '连接错误'}（未自动重发不确定请求）`
            : error instanceof Error
              ? error.message
              : '未知错误';
        throw new AiResponseError(
          `AI 调用失败：${reason}`,
          error instanceof OpenAI.APIError && !error.status ? 'UNKNOWN' : 'SERVICE_ERROR',
          metadata,
        );
      }
    }
  }
  async ping(baseUrl: string, apiKey: string, model: string): Promise<boolean> {
    try {
      const result = await this.chat({
        baseUrl,
        apiKey,
        model,
        messages: [{ role: 'user', content: 'Reply OK' }],
        maxTokens: 128,
        timeoutMs: 15_000,
      });
      return !!result.content;
    } catch {
      return false;
    }
  }
}
