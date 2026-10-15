// Isolated real API/database; only OCR and the remote GPT provider are synthetic.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canglin-browser-'));
process.env.DATA_DIR = directory;
process.env.DATABASE_URL = `file:${directory}/canglin.db`;
process.env.LLM_API_KEY = '';
delete process.env.LLM_API_KEY_FILE;
// 设置页的模型选项用默认的三个（不受开发机环境变量影响）
delete process.env.LLM_ALLOWED_MODELS;
execFileSync(
  process.execPath,
  [
    require.resolve('prisma/build/index.js'),
    'migrate',
    'deploy',
    '--schema',
    path.join(__dirname, '../prisma/schema.prisma'),
  ],
  { stdio: 'pipe' },
);
const { Test } = require('@nestjs/testing');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { AppModule } = require('../dist/app.module');
const { configureApp } = require('../dist/bootstrap');
const { OcrClient } = require('../dist/imports/ocr.client');
const { LlmClient, AiResponseError } = require('../dist/ai/llm.client');
const { capabilityImage } = require('../dist/ai/capability-image');
let sequence = 0;
const ocr = {
  inspect: async () => ({ pageCount: 1 }),
  health: async () => true,
  page: async () => ({ bytes: Buffer.from(capabilityImage().split(',')[1], 'base64'), mime: 'image/png' }),
  // The synthetic originals have no text layer: AI pages use recognition mode.
  textLayer: async () => ({ result: { mode: 'PDF_TEXT', items: [], warnings: [] }, textLayer: null }),
  parse: async () => ({
    schemaVersion: 2,
    parserVersion: 'browser-fixture',
    pageCount: 1,
    mode: 'IMAGE_OCR',
    pages: [{ page: 1, status: 'DONE', mode: 'IMAGE_OCR' }],
    warnings: [],
    serialNumber: `OA-BROWSER-${++sequence}`,
    department: '行政部',
    handler: '张三',
    requestDate: null,
    items: [
      {
        lineId: 'p1-r1',
        itemName: `测试用品${sequence}`,
        quantity: null,
        unit: '盒',
        unitPrice: 5,
        source: {
          page: 1,
          method: 'IMAGE_OCR',
          rawText: '测试用品 数量8盒',
          box: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        },
      },
    ],
  }),
};
const llm = {
  ping: async () => true,
  chat: async (opts) => {
    const last = opts.messages.at(-1);
    if (opts.tools)
      return {
        content: null,
        toolCalls: [{ id: 'cap-call', name: 'capability_check', args: { value: 7 } }],
        outputItems: [
          {
            type: 'function_call',
            call_id: 'cap-call',
            name: 'capability_check',
            arguments: '{"value":7}',
          },
        ],
      };
    if (last.role === 'tool') return { content: 'CAPABILITY_OK', toolCalls: [] };
    if (last.content.includes('RED_BLUE')) return { content: 'RED_BLUE', toolCalls: [] };
    if (last.content.includes('Return value 7')) return { content: '{"value":7}', toolCalls: [] };
    if (opts.baseUrl.includes('/timeout/'))
      throw new AiResponseError('合成超时，结果未知', 'UNKNOWN');
    const { existingRows = [], local = existingRows } = JSON.parse(last.content);
    // The original-image provider fixture works independently of local OCR output.
    const rows = local.length ? local : [{
      lineId: null, itemName: `测试用品${++sequence}`, unit: '盒', spec: '标准',
    }];
    return {
      content: JSON.stringify({
        templateType: null,
        serialNumber: `OA-BROWSER-${sequence}`,
        department: '行政部',
        handler: '张三',
        requestDate: '2026-09-27',
        items: rows.map((i) => ({
          lineId: i.lineId,
          rawText: i.itemName,
          itemName: i.itemName,
          spec: i.spec ?? null,
          quantity: 8,
          unit: i.unit,
          unitPrice: 5,
          amount: null,
          purchaseLink: null,
          catalogSuggestion: null,
        })),
        warnings: [],
      }),
      toolCalls: [],
      usage: { input: 50, output: 30 },
      requestId: 'synthetic',
    };
  },
};
(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OcrClient)
    .useValue(ocr)
    .overrideProvider(LlmClient)
    .useValue(llm)
    .compile();
  const app = module.createNestApplication(new FastifyAdapter(), { logger: false });
  await configureApp(app);
  await app.listen(3301, '127.0.0.1');
  const stop = async () => {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
