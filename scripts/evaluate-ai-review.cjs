// Explicit, bounded provider calls against local originals. Never connects to the production DB.
// Build shared/server first. Usage: LLM_API_KEY_FILE=/path/to/key node scripts/evaluate-ai-review.cjs DIR review|recognition
// DIR contains sources.json [{id}], provider.json {baseUrl,model,reasoningEffort}, <id>-grid.json and <id>.png or .jpg.
// Existing results are skipped, including failures; remove a specific result deliberately to retry it.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const server = path.resolve(__dirname, '../apps/server');
const { z } = require(path.join(server, 'node_modules/zod'));
const { LlmClient } = require(path.join(server, 'dist/ai/llm.client'));
const prompts = require(path.join(server, 'dist/ai/prompts'));
const { aiPageSchema, checkAiPage, checkReview, checkLinks } = require(path.join(server, 'dist/imports/import-result'));
async function main() {
  const [directory, mode] = process.argv.slice(2);
  if (!directory || !['review', 'recognition'].includes(mode)) throw new Error('Usage: evaluate-ai-review.cjs DIR review|recognition');
  const root = path.resolve(directory);
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'provider.json'), 'utf8'));
  if (!cfg.baseUrl || !cfg.model || !process.env.LLM_API_KEY_FILE) throw new Error('Provider configuration and LLM_API_KEY_FILE are required');
  const apiKey = fs.readFileSync(process.env.LLM_API_KEY_FILE, 'utf8').trim();
  const samples = JSON.parse(fs.readFileSync(path.join(root, 'sources.json'), 'utf8'));
  if (!samples.length || samples.length > 50) throw new Error('Expected 1–50 explicitly selected samples');
  const client = new LlmClient();
  for (const { id } of samples) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid sample id');
    const destination = path.join(root, `${id}-ai-${mode}.json`);
    const source = JSON.parse(fs.readFileSync(path.join(root, `${id}-grid.json`), 'utf8'));
    if (source.pageCount !== 1) throw new Error('Split multi-page samples before evaluation');
    const image = fs.readFileSync(path.join(root, fs.existsSync(path.join(root, `${id}.png`)) ? `${id}.png` : `${id}.jpg`));
    const mime = image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png' : 'image/jpeg';
    const header = Object.fromEntries(['serialNumber', 'department', 'handler', 'requestDate'].map(k => [k, source[k] ?? null]));
    const isReview = mode === 'review';
    const content = isReview ? prompts.reviewMessage({ page: 1, templateType: source.templateType ?? null, header,
      rows: source.items.map(row => ({ lineId: row.lineId, rawText: row.source?.rawText ?? row.itemName,
        spec: row.spec ?? null, quantity: row.quantity, unit: row.unit ?? null, unitPrice: row.unitPrice ?? null,
        amount: row.amount ?? null, purchaseLink: row.purchaseLink ?? null, note: row.note ?? null })) })
      : prompts.recognitionMessage({ page: 1, pageCount: source.pageCount, templateHint: source.templateType ?? null,
        existingRows: source.items.map(row => ({ lineId: row.lineId, itemName: row.itemName, spec: row.spec ?? null, quantity: row.quantity, unit: row.unit ?? null })), textLayer: source.textLayer ?? null, strips: 1 });
    const record = { id, mode, model: cfg.model, promptVersion: isReview ? prompts.REVIEW_PROMPT_VERSION : prompts.RECOGNITION_PROMPT_VERSION,
      reasoningEffort: cfg.reasoningEffort ?? 'auto',
      inputHash: createHash('sha256').update(content).update(image).update(mime)
        .update(isReview ? prompts.REVIEW_SYSTEM : prompts.RECOGNITION_SYSTEM)
        .update(JSON.stringify({ baseUrl: cfg.baseUrl, model: cfg.model, reasoningEffort: cfg.reasoningEffort })).digest('hex'), rejected: [] };
    if (fs.existsSync(destination)) {
      const previous = JSON.parse(fs.readFileSync(destination, 'utf8'));
      if (previous.inputHash !== record.inputHash || previous.model !== record.model || previous.promptVersion !== record.promptVersion) {
        throw new Error('Existing result has different input; use a separate evaluation directory');
      }
      console.log(JSON.stringify({ id, mode, skipped: true })); continue;
    }
    const start = Date.now();
    try {
      const response = await client.chat({ baseUrl: cfg.baseUrl, model: cfg.model, apiKey,
        reasoningEffort: cfg.reasoningEffort === 'off' ? undefined : cfg.reasoningEffort === 'auto' || !cfg.reasoningEffort ? 'medium' : cfg.reasoningEffort,
        schema: z.toJSONSchema(aiPageSchema), maxTokens: 12000, timeoutMs: 120000,
        onRejected: params => { record.rejected = params; },
        messages: [{ role: 'system', content: isReview ? prompts.REVIEW_SYSTEM : prompts.RECOGNITION_SYSTEM },
          { role: 'user', content, images: [`data:${mime};base64,${image.toString('base64')}`] }] });
      record.usage = response.usage; record.requestId = response.requestId;
      const parsed = aiPageSchema.parse(JSON.parse(response.content ?? ''));
      record.raw = structuredClone(parsed);
      checkAiPage(parsed, isReview);
      if (isReview) checkReview(1, parsed, source.items, source);
      else if (source.textLayer) checkLinks(parsed, source.textLayer);
      record.result = parsed; record.status = 'DONE';
    } catch (error) {
      // Do not persist raw provider errors, which can include credentials or HTTP headers.
      record.status = 'FAILED'; record.errorKind = error.kind ?? error.name ?? 'Error';
      record.usage ??= error.metadata?.usage;
    }
    record.elapsedMs = Date.now() - start;
    fs.writeFileSync(destination, JSON.stringify(record, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ id, mode, status: record.status, errorKind: record.errorKind, elapsedMs: record.elapsedMs, usage: record.usage }));
    if (record.status === 'FAILED') { process.exitCode = 1; break; }
  }
}
main().catch(() => { console.error('Evaluation setup failed; check local configuration and built server.'); process.exitCode = 1; });
