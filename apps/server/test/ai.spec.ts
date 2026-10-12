import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp, closeApp, type TestApp } from './utils';
import { LlmClient, type ChatCallOptions, type ChatCompletionResult } from '../src/ai/llm.client';
import { config } from '../src/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiSearchService } from '../src/ai/ai-search.service';
import { AiConfigService } from '../src/ai/ai-config.service';
import { compactToolResult } from '../src/ai/ai.service';
import type { WorkflowDocumentRow, WorkflowPage, WorkflowPriceRow, WorkflowRequestRow, WorkflowStockEntryRow, WorkflowStockRow } from '@canglin/shared';

/**
 * 假 LLM：jsonMode 调用（同义词扩展 / OCR 校对）统一回 json 字段；
 * 其余（问答 tool 循环）按 queue 顺序出队。
 */
class FakeLlm {
  calls: ChatCallOptions[] = [];
  queue: ChatCompletionResult[] = [];
  json = '{"terms":[]}';

  async chat(opts: ChatCallOptions): Promise<ChatCompletionResult> {
    this.calls.push(opts);
    if (opts.jsonMode || opts.schema) return { content: this.json, toolCalls: [] };
    const next = this.queue.shift();
    if (!next) throw new Error('FakeLml 队列为空');
    return next;
  }

  modelCalls: { baseUrl: string; apiKey: string }[] = [];
  async listModels(baseUrl: string, apiKey: string): Promise<string[]> {
    this.modelCalls.push({ baseUrl, apiKey });
    return ['synthetic-gpt'];
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

let ctx: TestApp;
let fake: FakeLlm;

beforeAll(async () => {
  fake = new FakeLlm();
  ctx = await createApp({
    override: (builder) => builder.overrideProvider(LlmClient).useValue(fake),
  });
});
afterAll(() => closeApp(ctx));

function auth(payload: Record<string, unknown> = {}): Record<string, unknown> {
  return { headers: { cookie: ctx.cookie, 'idempotency-key': crypto.randomUUID() }, ...payload };
}

async function seedRequest(itemName: string, quantity = '10'): Promise<void> {
  const res = await ctx.inject({
    method: 'POST',
    url: '/api/workflow/requests',
    ...auth({
      payload: {
        serialNumber: `OA-AI-${crypto.randomUUID().slice(0, 8)}`,
        department: '行政部',
        handler: '刘洋',
        requestDate: '2026-08-20',
        lines: [{ itemName, specification: '', unit: '件', quantity }],
      },
    }),
  });
  expect(res.statusCode, res.body).toBe(201);
}

describe('AI 配置', () => {
  it('默认未启用且不回传 Key', async () => {
    const res = await ctx.inject({ method: 'GET', url: '/api/ai/config', ...auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(false);
    expect(body.apiKeySet).toBe(false);
    expect(body.baseUrl).toMatch(/^https?:\/\//);
    expect(body).not.toHaveProperty('apiKey');
  });

  it('模型列表要求登录和密钥，缺少配置时不访问服务商', async () => {
    const anonymous = await ctx.inject({ method: 'GET', url: '/api/ai/models' });
    expect(anonymous.statusCode).toBe(401);
    const missing = await ctx.inject({ method: 'GET', url: '/api/ai/models', ...auth() });
    expect(missing.statusCode).toBe(400);
    expect(fake.modelCalls).toHaveLength(0);
  });

  it('服务器密钥无需页面填写即可获取模型，且不回传或保存到数据库', async () => {
    const previous = config.llmDefaults.apiKey;
    Object.defineProperty(config.llmDefaults, 'apiKey', { value: 'server-only-secret' });
    try {
      const current = await ctx.inject({ method: 'GET', url: '/api/ai/config', ...auth() });
      expect(current.json()).toMatchObject({
        apiKeySet: true,
        keySource: 'server',
        enabled: false,
      });
      expect(current.body).not.toContain('server-only-secret');
      const models = await ctx.inject({ method: 'GET', url: '/api/ai/models', ...auth() });
      expect(models.json()).toEqual({ models: ['synthetic-gpt'] });
      expect(fake.modelCalls.at(-1)?.apiKey).toBe('server-only-secret');
      const save = await ctx.inject({
        method: 'PUT',
        url: '/api/ai/config',
        ...auth({
          payload: {
            enabled: false,
            baseUrl: config.llmDefaults.baseUrl,
            model: 'synthetic-gpt',
            semanticSearch: true,
          },
        }),
      });
      expect(save.statusCode).toBe(200);
      expect(save.body).not.toContain('server-only-secret');
      const row = await ctx.app
        .get(PrismaService)
        .setting.findUnique({ where: { key: 'aiConfig' } });
      expect(row?.value).not.toContain('server-only-secret');
      expect(JSON.parse(row!.value).apiKey).toBe('');
    } finally {
      Object.defineProperty(config.llmDefaults, 'apiKey', { value: previous });
    }
  });

  it('未启用时 ask 返回 400；OCR 校对接口已删除', async () => {
    const ask = await ctx.inject({
      method: 'POST',
      url: '/api/ai/ask',
      ...auth({ payload: { question: '有多少条台账？' } }),
    });
    expect(ask.statusCode).toBe(400);
    const review = await ctx.inject({
      method: 'POST',
      url: '/api/ai/ocr-review',
      ...auth({ payload: { taskId: 'whatever' } }),
    });
    expect(review.statusCode).toBe(404);
  });

  it('没有 Key 不允许启用', async () => {
    const res = await ctx.inject({
      method: 'PUT',
      url: '/api/ai/config',
      ...auth({
        payload: {
          enabled: true,
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          model: 'glm-4.6',
          semanticSearch: true,
        },
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('保存后 Key 只以 apiKeySet 暴露；留空不覆盖', async () => {
    const put = await ctx.inject({
      method: 'PUT',
      url: '/api/ai/config',
      ...auth({
        payload: {
          enabled: true,
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          model: 'glm-4.6',
          semanticSearch: true,
          apiKey: 'sk-test-123',
        },
      }),
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ enabled: true, apiKeySet: true, model: 'glm-4.6' });

    // 改模型不填 Key
    const put2 = await ctx.inject({
      method: 'PUT',
      url: '/api/ai/config',
      ...auth({
        payload: {
          enabled: true,
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          model: 'glm-4.7',
          semanticSearch: false,
          apiKey: '',
        },
      }),
    });
    expect(put2.statusCode).toBe(200);
    expect(put2.json()).toMatchObject({ apiKeySet: true, model: 'glm-4.7', semanticSearch: false });

    // 恢复 semanticSearch，后续用例要用
    await ctx.inject({
      method: 'PUT',
      url: '/api/ai/config',
      ...auth({
        payload: {
          enabled: true,
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          model: 'glm-4.6',
          semanticSearch: true,
        },
      }),
    });
  });

  it('旧的分任务模型不再生效，旧页面提交也只能保存一个模型', async () => {
    const prisma = ctx.app.get(PrismaService);
    const row = await prisma.setting.findUniqueOrThrow({ where: { key: 'aiConfig' } });
    const legacy = {
      ...JSON.parse(row.value),
      importModel: 'old-import',
      askModel: 'old-ask',
      searchModel: 'old-search',
    };
    await prisma.setting.update({
      where: { key: 'aiConfig' },
      data: { value: JSON.stringify(legacy) },
    });
    const loaded = await ctx.inject({ method: 'GET', url: '/api/ai/config', ...auth() });
    for (const field of ['importModel', 'askModel', 'searchModel'])
      expect(loaded.json()).not.toHaveProperty(field);
    const before = fake.calls.length;
    fake.queue = [{ content: '统一模型回答', toolCalls: [] }];
    const answer = await ctx.inject({
      method: 'POST',
      url: '/api/ai/ask',
      ...auth({ payload: { question: '你好' } }),
    });
    expect(answer.statusCode).toBe(201);
    expect(fake.calls[before].model).toBe(legacy.model);
    const saved = await ctx.inject({
      method: 'PUT',
      url: '/api/ai/config',
      ...auth({ payload: legacy }),
    });
    expect(saved.statusCode).toBe(200);
    const stored = await prisma.setting.findUniqueOrThrow({ where: { key: 'aiConfig' } });
    for (const field of ['importModel', 'askModel', 'searchModel'])
      expect(JSON.parse(stored.value)).not.toHaveProperty(field);
  });

  it('health 返回假客户端的连通结果', async () => {
    const res = await ctx.inject({ method: 'GET', url: '/api/ai/health', ...auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('AI 问答', () => {
  it('tool-calling：先查申请再作答，steps 记录调用轨迹', async () => {
    await seedRequest('A4复印纸'); // 同时供语义搜索词表使用
    await seedRequest('签字笔', '5');

    fake.queue = [
      {
        content: null,
        toolCalls: [{ id: 'call-1', name: 'query_requests', args: { search: '签字笔', pageSize: 5 } }],
      },
      { content: '共 1 条签字笔记录。', toolCalls: [] },
    ];
    const res = await ctx.inject({
      method: 'POST',
      url: '/api/ai/ask',
      ...auth({ payload: { question: '有签字笔的申请吗？' } }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.answer).toBe('共 1 条签字笔记录。');
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0]).toMatchObject({ name: 'query_requests', count: 1 });
    expect(body.model).toBe('glm-4.6');

    // 第二轮请求里应带有工具结果消息
    const second = fake.calls.find((c) => c.messages.some((m) => m.role === 'tool'));
    expect(second?.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'call-1')).toBe(
      true,
    );
  });

  it('模型直接回答时不产生 steps', async () => {
    fake.queue = [{ content: '不知道', toolCalls: [] }];
    const res = await ctx.inject({
      method: 'POST',
      url: '/api/ai/ask',
      ...auth({ payload: { question: '你好' } }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().steps).toEqual([]);
    expect(fake.calls.at(-1)).toMatchObject({ reasoningEffort: 'medium' });
    expect(fake.calls.at(-1)?.temperature).toBeUndefined();
  });
});

describe('工具结果压缩', () => {
  const document = (id: number, lines: number) => ({
    id, kind: 'PURCHASE', status: 'POSTED', supplierName: null, note: '', totalAmount: null, createdAt: '2026-09-01T00:00:00Z',
    attachments: [{ id: 9, kind: 'INVOICE', filename: '发票.pdf' }],
    lines: Array.from({ length: lines }, (_, i) => ({ id: i, itemName: `物品${i}`, unitPrice: null, quantity: '1', spec: '' })),
  });

  it('去掉空值和时间戳，保留表示「未知」的金额与价格，附件只留类型和文件名，每张单据最多 20 行', () => {
    const value = JSON.parse(compactToolResult({ items: [document(1, 25)], total: 1 }));
    const doc = value.items[0];
    expect(doc).not.toHaveProperty('createdAt');
    expect(doc).not.toHaveProperty('supplierName');
    expect(doc).not.toHaveProperty('note');
    expect(doc.totalAmount).toBeNull();
    expect(doc.attachments).toEqual(['INVOICE:发票.pdf']);
    expect(doc.lines).toHaveLength(20);
    expect(doc.linesTruncated).toBe(true);
    expect(doc.lines[0]).toEqual({ id: 0, itemName: '物品0', unitPrice: null, quantity: '1' });
  });

  it('仍超过上限时从末尾删条目，标记 truncated 与 hint，结果始终是合法 JSON', () => {
    const json = compactToolResult({ items: Array.from({ length: 60 }, (_, i) => document(i, 20)), total: 60 });
    expect(json.length).toBeLessThanOrEqual(16_000);
    const value = JSON.parse(json);
    expect(value).toMatchObject({ truncated: true, hint: '缩小日期范围或减少 pageSize', total: 60 });
    expect(value.items.length).toBeGreaterThan(0);
    expect(value.items.length).toBeLessThan(60);
    expect(JSON.parse(compactToolResult({ blob: 'x'.repeat(20_000) }))).toEqual({
      truncated: true, hint: '结果过大，请缩小日期范围或指定物品、供应商后再查' });
  });

  it('报表结果超限时删分组明细、保留汇总金额', () => {
    const report = { grossPurchaseAmount: '12345.67', netPurchaseAmount: '12000.00',
      recipients: Array.from({ length: 400 }, (_, i) => ({ recipient: `领用人${i}`, department: '行政部', itemName: `物品${i}`, quantity: '1' })) };
    const value = JSON.parse(compactToolResult(report));
    expect(value).toMatchObject({ grossPurchaseAmount: '12345.67', netPurchaseAmount: '12000.00', truncated: true });
    expect(value.recipients.length).toBeGreaterThan(0);
    expect(value.recipients.length).toBeLessThan(400);
  });
});

describe('AI 调用参数', () => {
  it('按用途发送推理强度；服务拒绝过的参数按配置指纹记住，之后不再发送', async () => {
    const service = ctx.app.get(AiConfigService);
    const cfg = await service.getConfig();
    expect(await service.params(cfg, 'import')).toMatchObject({ reasoningEffort: 'low' });
    expect(await service.params(cfg, 'search', 0)).toMatchObject({ temperature: 0 });
    expect((await service.params(cfg, 'search', 0)).reasoningEffort).toBeUndefined();
    await (await service.params(cfg, 'import', 0)).onRejected!(['temperature']);
    const after = await service.params(cfg, 'import', 0);
    expect(after.temperature).toBeUndefined();
    expect(after.reasoningEffort).toBe('low');
    // 换模型（指纹变化）后重新尝试
    expect(await service.params({ ...cfg, model: 'another-model' }, 'import', 0)).toMatchObject({ temperature: 0 });
    // 「不发送」：两者都不带；固定强度对所有用途生效
    expect(await service.params({ ...cfg, reasoningEffort: 'off' }, 'ask', 0)).toEqual({});
    expect(await service.params({ ...cfg, reasoningEffort: 'high' }, 'ask')).toMatchObject({ reasoningEffort: 'high' });
    // 搜索只有 512 个输出 token：固定强度也不发推理
    expect((await service.params({ ...cfg, reasoningEffort: 'high' }, 'search')).reasoningEffort).toBeUndefined();
    await prisma().setting.deleteMany({ where: { key: 'aiParamSupport' } });
  });

  it('能力检测不发送推理强度与温度，并重新学习服务接受的参数', async () => {
    const service = ctx.app.get(AiConfigService);
    const cfg = await service.getConfig();
    await (await service.params(cfg, 'ask')).onRejected!(['reasoning']);
    const before = fake.calls.length;
    const res = await ctx.inject({ method: 'POST', url: '/api/ai/capabilities', ...auth() });
    expect(res.statusCode).toBe(201);
    const calls = fake.calls.slice(before);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.reasoningEffort === undefined && c.temperature === undefined)).toBe(true);
    expect(calls.some((c) => c.messages.some((m) => m.images?.length === 1))).toBe(true);
    expect(await service.params(cfg, 'ask')).toMatchObject({ reasoningEffort: 'medium' });
  });

  it('设置页可保存推理强度，并拒绝未知取值', async () => {
    const current = (await ctx.inject({ method: 'GET', url: '/api/ai/config', ...auth() })).json();
    expect(current.reasoningEffort).toBe('auto');
    const payload = { enabled: current.enabled, baseUrl: current.baseUrl, model: current.model, semanticSearch: current.semanticSearch };
    const saved = await ctx.inject({ method: 'PUT', url: '/api/ai/config', ...auth({ payload: { ...payload, reasoningEffort: 'off' } }) });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().reasoningEffort).toBe('off');
    const bad = await ctx.inject({ method: 'PUT', url: '/api/ai/config', ...auth({ payload: { ...payload, reasoningEffort: 'turbo' } }) });
    expect(bad.statusCode).toBe(400);
    await ctx.inject({ method: 'PUT', url: '/api/ai/config', ...auth({ payload: { ...payload, reasoningEffort: 'auto' } }) });
  });
});

function prisma() {
  return ctx.app.get(PrismaService);
}

async function get<T>(url: string, query: Record<string, string>): Promise<T> {
  const res = await ctx.inject({ method: 'GET', url, ...auth({ query }) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as T;
}

describe('AI 语义搜索', () => {
  const requestNames = (page: WorkflowPage<WorkflowRequestRow>) =>
    new Set(page.items.flatMap((request) => request.lines.map((line) => line.itemName)));
  const stockNames = (rows: WorkflowStockRow[]) => rows.map((row) => row.itemName);
  const entryNames = (page: WorkflowPage<WorkflowStockEntryRow>) =>
    new Set(page.items.map((entry) => entry.itemName));
  const priceNames = (rows: WorkflowPriceRow[]) => new Set(rows.map((row) => row.itemName));
  const semanticSearch = (enabled: boolean) =>
    ctx.inject({
      method: 'PUT',
      url: '/api/ai/config',
      ...auth({
        payload: { enabled: true, baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6', semanticSearch: enabled },
      }),
    });

  beforeAll(async () => {
    // 品名字面包含「打印纸」：区分原词命中与同义词命中
    await seedRequest('激光打印纸（A3）');
  });

  it('词表变化后同一搜索词重新扩展，不沿用旧的扩展结果', async () => {
    const prisma = ctx.app.get(PrismaService);
    const chat = { calls: 0 };
    const llm = { chat: async (opts: ChatCallOptions) => {
      chat.calls++;
      expect(opts.messages[0].content).toContain('不要选择只是同类别但明显不同的物品');
      return { content: '{"terms":[]}', toolCalls: [] };
    } };
    const config = { semanticSearchEnabled: async () => true, getConfig: async () => ({}), params: async () => ({}) };
    const search = new AiSearchService(prisma, config as never, llm as never);
    await search.synonyms('缓存测试词');
    await search.synonyms('缓存测试词');
    expect(chat.calls).toBe(1);
    await prisma.catalogProduct.create({ data: { name: '词表新增品名', specification: '', unit: '个' } });
    (search as unknown as { vocabCache: { exp: number } }).vocabCache.exp = 0; // 词表缓存到期后重新读库
    await search.synonyms('缓存测试词');
    expect(chat.calls).toBe(2);
  });

  it('词表来自申请明细与物品目录：申请品名按出现次数降序，去重', async () => {
    const prisma = ctx.app.get(PrismaService);
    await seedRequest('A4复印纸', '2'); // 同名再出现一次，词表中仍只有一个
    // 按名称「档案盒」在前；「订书钉」出现次数更多，词表中应排在前面
    for (let i = 0; i < 3; i++) await seedRequest('订书钉', '1');
    await seedRequest('档案盒', '1');
    await prisma.catalogProduct.create({ data: { name: '目录专有品名', specification: '', unit: '个' } });
    // 应用内实例的词表已在问答搜索时缓存（5 分钟），这里用新实例直接读库
    const vocab = await new AiSearchService(prisma, ctx.app.get(AiConfigService), ctx.app.get(LlmClient)).vocabulary();
    expect(vocab).toEqual(expect.arrayContaining(['A4复印纸', '签字笔', '订书钉', '档案盒', '目录专有品名']));
    expect(vocab.filter((name) => name === 'A4复印纸')).toHaveLength(1);
    expect(vocab.indexOf('订书钉')).toBeLessThan(vocab.indexOf('档案盒'));
  });

  it('申请、库存与单据搜索：原词照常命中，品名另按同义词扩展', async () => {
    const prisma = ctx.app.get(PrismaService);
    fake.json = '{"terms":["A4复印纸"]}';
    const before = fake.calls.length;
    const requests = await get<WorkflowPage<WorkflowRequestRow>>('/api/workflow/requests', { search: '打印纸' });
    expect(requestNames(requests)).toEqual(new Set(['A4复印纸', '激光打印纸（A3）']));
    const stock = await get<WorkflowStockRow[]>('/api/workflow/stock', { search: '打印纸' });
    expect(stockNames(stock)).toEqual(['A4复印纸', '激光打印纸（A3）']);

    const supplier = await prisma.supplier.create({ data: { name: '语义搜索测试供应商' } });
    const line = requests.items.flatMap((request) => request.lines).find((row) => row.itemName === 'A4复印纸')!;
    const purchase = await ctx.inject({
      method: 'POST',
      url: '/api/workflow/purchases',
      ...auth({
        payload: { date: '2026-08-21', supplierId: supplier.id, lines: [{ requestLineId: line.id, quantity: '1', unitPrice: '1' }] },
      }),
    });
    expect(purchase.statusCode, purchase.body).toBe(201);
    const documents = await get<WorkflowPage<WorkflowDocumentRow>>('/api/workflow/documents', { search: '打印纸' });
    expect(documents.items.map((document) => document.id)).toEqual([purchase.json().id]);
    // 同一搜索词走缓存：三处搜索只调用一次模型
    expect(fake.calls.length - before).toBe(1);
  });

  it('词表外的扩展词被丢弃，词表内的扩展词照常命中', async () => {
    // 「激光打印纸」不是现有品名（只有「激光打印纸（A3）」），未被丢弃就会经包含匹配误命中
    fake.json = '{"terms":["激光打印纸","签字笔"]}';
    const requests = await get<WorkflowPage<WorkflowRequestRow>>('/api/workflow/requests', { search: '打印纸2' });
    expect(requestNames(requests)).toEqual(new Set(['签字笔']));
  });

  it('关闭语义搜索后不调用模型，只按原词包含匹配', async () => {
    expect((await semanticSearch(false)).statusCode).toBe(200);
    fake.json = '{"terms":["A4复印纸"]}';
    const before = fake.calls.length;
    // 「打印纸」此前已扩展为「A4复印纸」并缓存，关闭后不再沿用
    const requests = await get<WorkflowPage<WorkflowRequestRow>>('/api/workflow/requests', { search: '打印纸' });
    expect(requestNames(requests)).toEqual(new Set(['激光打印纸（A3）']));
    expect(stockNames(await get<WorkflowStockRow[]>('/api/workflow/stock', { search: '打印纸' }))).toEqual(['激光打印纸（A3）']);
    expect((await get<WorkflowPage<WorkflowDocumentRow>>('/api/workflow/documents', { search: '打印纸' })).total).toBe(0);
    expect(fake.calls.length).toBe(before);
    expect((await semanticSearch(true)).statusCode).toBe(200);
  });

  it('库存流水与比价搜索：品名按同义词扩展，规格只按原词；关闭后只按原词匹配', async () => {
    const prisma = ctx.app.get(PrismaService);
    // 「签字笔」在品名词表内，作为「中性笔」的同义词；其余三行：品名含原词、规格含原词、规格只含同义词（规格不扩展，不应命中）
    const created = await ctx.inject({
      method: 'POST',
      url: '/api/workflow/requests',
      ...auth({
        payload: {
          serialNumber: `OA-AI-${crypto.randomUUID().slice(0, 8)}`,
          department: '行政部',
          handler: '刘洋',
          requestDate: '2026-08-20',
          lines: [
            { itemName: '签字笔', specification: '', unit: '件', quantity: '2' },
            { itemName: '黑色中性笔', specification: '', unit: '件', quantity: '2' },
            { itemName: '替换笔芯', specification: '中性笔 0.5mm', unit: '件', quantity: '2' },
            { itemName: '笔袋', specification: '可装签字笔', unit: '件', quantity: '2' },
          ],
        },
      }),
    });
    expect(created.statusCode, created.body).toBe(201);
    const supplier = await prisma.supplier.create({ data: { name: '同义词比价测试供应商' } });
    const purchase = await ctx.inject({
      method: 'POST',
      url: '/api/workflow/purchases',
      ...auth({
        payload: {
          date: '2026-08-21',
          supplierId: supplier.id,
          lines: created.json<WorkflowRequestRow>().lines.map((line) => ({ requestLineId: line.id, quantity: '2', unitPrice: '3' })),
        },
      }),
    });
    expect(purchase.statusCode, purchase.body).toBe(201);
    const receipt = await ctx.inject({
      method: 'POST',
      url: '/api/workflow/receipts',
      ...auth({
        payload: {
          date: '2026-08-22',
          lines: purchase.json<WorkflowDocumentRow>().lines.map((line) => ({ purchaseLineId: line.id, quantity: '2' })),
        },
      }),
    });
    expect(receipt.statusCode, receipt.body).toBe(201);
    const search = async () => ({
      entries: await get<WorkflowPage<WorkflowStockEntryRow>>('/api/workflow/entries', { search: '中性笔' }),
      prices: await get<WorkflowPriceRow[]>('/api/workflow/prices', { search: '中性笔' }),
    });

    fake.json = '{"terms":["签字笔"]}';
    const expanded = await search();
    expect(entryNames(expanded.entries)).toEqual(new Set(['签字笔', '黑色中性笔', '替换笔芯']));
    expect(expanded.entries.total).toBe(3);
    expect(priceNames(expanded.prices)).toEqual(new Set(['签字笔', '黑色中性笔', '替换笔芯']));

    expect((await semanticSearch(false)).statusCode).toBe(200);
    const before = fake.calls.length;
    const literal = await search();
    expect(entryNames(literal.entries)).toEqual(new Set(['黑色中性笔', '替换笔芯']));
    expect(literal.entries.total).toBe(2);
    expect(priceNames(literal.prices)).toEqual(new Set(['黑色中性笔', '替换笔芯']));
    expect(fake.calls.length).toBe(before);
    expect((await semanticSearch(true)).statusCode).toBe(200);
  });
});
