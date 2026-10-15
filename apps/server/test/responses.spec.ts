import { afterEach, it, expect, vi } from 'vitest';
import { LlmClient, strictSchema } from '../src/ai/llm.client';
import { z } from 'zod';
import { aiPageSchema } from '../src/imports/import-result';
const opts = {
  apiKey: 'test-secret',
  baseUrl: 'https://provider.example/v1',
  model: 'test-gpt',
  messages: [{ role: 'user' as const, content: 'extract', images: ['data:image/png;base64,AA=='] }],
};
afterEach(() => vi.unstubAllGlobals());
function result(
  status = 'completed',
  output: unknown[] = [
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: '{"quantity":null}', annotations: [] }],
    },
  ],
  usage: Record<string, number> = { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
) {
  return new Response(
    JSON.stringify({
      id: 'resp_1',
      object: 'response',
      status,
      output,
      usage,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'x-request-id': 'req_1' } },
  );
}
it('uses Responses image input, strict schema and no remote storage', async () => {
  const fetch = vi.fn(async () => result());
  vi.stubGlobal('fetch', fetch);
  const response = await new LlmClient().chat({
    ...opts,
    schema: {
      type: 'object',
      properties: { quantity: { type: ['number', 'null'] } },
      required: ['quantity'],
      additionalProperties: false,
    },
  });
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  const body = JSON.parse(init.body as string);
  expect(String(url)).toBe('https://provider.example/v1/responses');
  expect(body.store).toBe(false);
  expect(body.text.format.type).toBe('json_schema');
  expect(body.input[0].content[1].type).toBe('input_image');
  expect(response.content).toBe('{"quantity":null}');
  expect(response.usage).toEqual({ input: 10, output: 20 });
});
function failure(status: number, message: string, param: string | null = null) {
  return new Response(JSON.stringify({ error: { message, type: 'invalid_request_error', param, code: null } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function bodies(fetch: ReturnType<typeof vi.fn>) {
  return fetch.mock.calls.map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
}
it('sends several images of one page in order within one user message', async () => {
  const fetch = vi.fn(async () => result());
  vi.stubGlobal('fetch', fetch);
  await new LlmClient().chat({ ...opts, messages: [{ role: 'user', content: 'page', images: ['data:a', 'data:b'] }] });
  expect(bodies(fetch)[0].input[0].content.map((c: { type: string; image_url?: string }) => c.image_url ?? c.type)).toEqual([
    'input_text', 'data:a', 'data:b',
  ]);
});
it('writes temperature and reasoning effort into the request', async () => {
  const fetch = vi.fn(async () => result());
  vi.stubGlobal('fetch', fetch);
  await new LlmClient().chat({ ...opts, temperature: 0, reasoningEffort: 'low' });
  expect(bodies(fetch)[0]).toMatchObject({ temperature: 0, reasoning: { effort: 'low' } });
});
it.each([
  ['temperature', "Unsupported parameter: 'temperature' is not supported with this model.", 'temperature'],
  ['reasoning', '当前模型不支持 reasoning.effort 参数', null],
])('drops a rejected %s once, resends and reports it', async (param, message, field) => {
  const fetch = vi.fn().mockResolvedValueOnce(failure(400, message, field)).mockResolvedValue(result());
  vi.stubGlobal('fetch', fetch);
  const onRejected = vi.fn();
  const response = await new LlmClient().chat({ ...opts, temperature: 0, reasoningEffort: 'low', onRejected });
  expect(response.content).toBe('{"quantity":null}');
  const [first, second] = bodies(fetch);
  expect(param in first && !(param in second)).toBe(true);
  expect(onRejected).toHaveBeenCalledWith([param]);
});
it('resends a rejected parameter only once and does not retry other 400 errors', async () => {
  const twice = vi.fn(async () => failure(400, 'temperature is not supported'));
  vi.stubGlobal('fetch', twice);
  await expect(new LlmClient().chat({ ...opts, temperature: 0 })).rejects.toThrow('400');
  expect(twice).toHaveBeenCalledTimes(2);
  const other = vi.fn(async () => failure(400, 'image too large'));
  vi.stubGlobal('fetch', other);
  await expect(new LlmClient().chat({ ...opts, temperature: 0 })).rejects.toThrow('400');
  expect(other).toHaveBeenCalledTimes(1);
});
it('explains outputs cut off by the token limit', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    id: 'resp_1', object: 'response', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [],
    usage: { input_tokens: 10, output_tokens: 12000, total_tokens: 12010 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  const error = await new LlmClient().chat(opts).catch((e) => e);
  expect(error.message).toBe('模型输出超过上限，请减少单页行数或拆分页面');
  expect(error.metadata).toMatchObject({ incompleteReason: 'max_output_tokens', usage: { input: 10, output: 12000 } });
});
it('rejects truncated outputs instead of applying their JSON', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => result('incomplete')),
  );
  await expect(new LlmClient().chat(opts)).rejects.toThrow('截断');
});
it('rejects refusal', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      result('completed', [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }]),
    ),
  );
  await expect(new LlmClient().chat(opts)).rejects.toThrow('拒绝');
});
it('does not repeat unknown connection failures', async () => {
  const fetch = vi.fn(async () => {
    throw new TypeError('connection lost');
  });
  vi.stubGlobal('fetch', fetch);
  await expect(new LlmClient().chat(opts)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('preserves response items and function call IDs across rounds', async () => {
  const fetch = vi.fn(async () =>
    result('completed', [
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'lookup',
        arguments: '{"id":7}',
      },
    ]),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new LlmClient(),
    first = await client.chat({
      ...opts,
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            description: 'read',
            parameters: {
              type: 'object',
              properties: { id: { type: 'integer' } },
              required: ['id'],
            },
          },
        },
      ],
    });
  expect(first.toolCalls).toEqual([{ id: 'call_1', name: 'lookup', args: { id: 7 } }]);
  await client.chat({
    ...opts,
    messages: [
      { role: 'assistant', content: null, responseItems: first.outputItems },
      { role: 'tool', tool_call_id: 'call_1', content: '7' },
    ],
  });
  const body = JSON.parse(
    (fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
  );
  expect(body.input[0].call_id).toBe('call_1');
  expect(body.input[1]).toEqual({ type: 'function_call_output', call_id: 'call_1', output: '7' });
});
it('drops zod defaults from strict schemas: the AI page contract keeps unitGuess required and nullable', () => {
  const schema = strictSchema(z.toJSONSchema(aiPageSchema) as Record<string, unknown>);
  expect(JSON.stringify(schema)).not.toContain('"default"');
  const item = ((schema.properties as Record<string, { items: Record<string, unknown> }>).items).items;
  expect(item.required).toContain('unitGuess');
  expect((item.properties as Record<string, unknown>).unitGuess).toEqual({ type: ['string', 'null'] });
});
it('makes optional arguments nullable while preserving required constraints', () => {
  const schema = strictSchema({
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'number' } },
    required: ['a'],
  });
  expect(schema.required).toEqual(['a', 'b']);
  expect(schema.additionalProperties).toBe(false);
});
it('replays opaque reasoning items without dropping their encrypted content', async () => {
  const fetch = vi.fn(async () => result());
  vi.stubGlobal('fetch', fetch);
  await new LlmClient().chat({
    ...opts,
    messages: [
      {
        role: 'assistant',
        content: null,
        responseItems: [
          { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'opaque-state' },
        ],
      },
    ],
  });
  const body = JSON.parse(
    (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
  );
  expect(body.input[0]).toMatchObject({ type: 'reasoning', encrypted_content: 'opaque-state' });
});
it('retries a rate limit only once', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: { message: 'busy' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(new LlmClient().chat(opts)).rejects.toThrow('429');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('treats missing third-party usage fields as unknown', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => result('completed', undefined, {})),
  );
  const response = await new LlmClient().chat(opts);
  expect(response.usage).toBeUndefined();
  expect(response.content).toBe('{"quantity":null}');
});

it('discovers model IDs using saved provider credentials without a generation request', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, { id: '' }] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  expect(await new LlmClient().listModels(opts.baseUrl + '/', opts.apiKey)).toEqual(['a', 'b']);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(String(url)).toBe('https://provider.example/v1/models');
  expect(init.method).toBe('GET');
  expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-secret');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([401, 404, 500, 200])(
  'model discovery safely handles unsupported, rejected and malformed responses (%s)',
  async (status) => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: 'test-secret' },
            data: status === 200 ? [{ id: 42 }] : undefined,
          }),
          { status, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(new LlmClient().listModels(opts.baseUrl, opts.apiKey)).rejects.toThrow(
      '无法获取模型列表',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
