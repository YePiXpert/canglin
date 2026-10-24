import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp, closeApp, type TestApp } from './utils';
import { InvoiceRecognitionService } from '../src/execution/invoice-recognition.service';
import { OcrClient } from '../src/imports/ocr.client';
import { AiConfigService } from '../src/ai/ai-config.service';
import { LlmClient } from '../src/ai/llm.client';
import { PrismaService } from '../src/prisma/prisma.service';
let ctx: TestApp, service: InvoiceRecognitionService, prisma: PrismaService;
const ocr = { inspect: vi.fn(async () => ({ pageCount: 2 })), textLayer: vi.fn(async () => ({ textLayer: '发票号码：001234567890\n开票日期：2026年10月23日\n销售方名称：测试销货方\n价税合计（小写）￥1,234.56', result: { mode: 'PDF_TEXT', items: [], warnings: [] } })), page: vi.fn(async () => ({ bytes: Buffer.from('test-image'), mime: 'image/png' })) };
const file = { filename: 'test.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7 synthetic-invoice'), size: 26 };
beforeAll(async () => { ctx = await createApp({ override: builder => builder.overrideProvider(OcrClient).useValue(ocr) }); service = ctx.app.get(InvoiceRecognitionService); prisma = ctx.app.get(PrismaService); await prisma.supplier.create({ data: { name: '测试销货方' } }); });
afterAll(() => closeApp(ctx));
it('本地逐页提取保留号码前导零，重复请求复用建议，不创建票据', async () => {
  const key = randomUUID(); const result = await service.recognize(file, 'LOCAL', 1, key);
  expect(result).toMatchObject({ number: '001234567890', date: '2026-10-23', amount: '1234.56', page: 1, pageCount: 2, supplierId: expect.any(Number) });
  expect(await service.recognize(file, 'LOCAL', 1, key)).toEqual(result); expect(ocr.textLayer).toHaveBeenCalledTimes(1); expect(await prisma.invoiceRecord.count()).toBe(0);
  await expect(service.recognize(file, 'LOCAL', 2, key)).rejects.toThrow('已变化');
  await expect(service.recognize(file, 'LOCAL', 3, randomUUID())).rejects.toThrow('页码');
});
it('图片本地模式保持空字段并引导人工或 AI；格式不受支持时拒绝', async () => {
  expect(await service.recognize({ ...file, filename: 'photo.jpg' }, 'LOCAL', 1, randomUUID())).toMatchObject({ number: null, amount: null, warning: expect.stringContaining('人工填写') });
  await expect(service.recognize({ ...file, filename: 'payload.html' }, 'LOCAL', 1, randomUUID())).rejects.toThrow('PDF');
});
it('AI 只返回可编辑字段，无效日期和金额留空，失败后同键可重试', async () => {
  const config = ctx.app.get(AiConfigService), cfg = await config.getConfig();
  const get = vi.spyOn(config, 'getConfig').mockResolvedValue({ ...cfg, enabled: true, apiKey: 'test' });
  const capabilities = vi.spyOn(config, 'capabilities').mockResolvedValue({ text: true, image: true, structured: true, tools: true, checkedAt: new Date().toISOString(), fingerprint: 'test' });
  const chat = vi.spyOn(ctx.app.get(LlmClient), 'chat');
  try {
    const key = randomUUID(); chat.mockRejectedValueOnce(new Error('timeout')); await expect(service.recognize(file, 'AI', 1, key)).rejects.toThrow('未创建业务记录');
    chat.mockResolvedValueOnce({ content: JSON.stringify({ number: '000987654321', date: '2026-02-30', amount: 'uncertain', supplierName: '不存在的销货方', warning: '请核对模糊字段' }), toolCalls: [] });
    expect(await service.recognize(file, 'AI', 1, key)).toMatchObject({ number: '000987654321', date: null, amount: null, supplierId: null });
    expect(chat.mock.calls[1][0].messages[1].images).toHaveLength(1); expect(await prisma.invoiceRecord.count()).toBe(0); expect(await prisma.financialRecord.count()).toBe(0);
  } finally { chat.mockRestore(); get.mockRestore(); capabilities.mockRestore(); }
});
