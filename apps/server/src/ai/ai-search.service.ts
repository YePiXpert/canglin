import { maintenance } from '../common/maintenance';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiConfigService } from './ai-config.service';
import { LlmClient } from './llm.client';

const CACHE_TTL_MS = 10 * 60_000;
const VOCAB_TTL_MS = 5 * 60_000;
const MAX_SYNONYMS = 8;

/**
 * 语义搜索扩展：把用户输入的搜索词扩展为库里真实存在的近似品名。
 * 独立于 AiService（后者依赖各查询模块，若放一起会与业务模块循环依赖）。
 */
@Injectable()
export class AiSearchService {
  private readonly logger = new Logger(AiSearchService.name);
  private epoch = maintenance.epoch;
  private readonly cache = new Map<string, { terms: string[]; exp: number }>();
  private vocabCache: { names: string[]; exp: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiConfig: AiConfigService,
    private readonly llm: LlmClient,
  ) {}

  /**
   * 返回与 term 语义相近、且确实存在于申请明细/物品目录中的品名（不含 term 本身与已被 contains 命中的词）。
   * 任何失败都降级为空数组，绝不阻塞原有搜索。
   */
  async synonyms(term: string): Promise<string[]> {
    if (this.epoch !== maintenance.epoch) {
      this.cache.clear();
      this.vocabCache = null;
      this.epoch = maintenance.epoch;
    }
    if (term.length < 2 || /^\d+$/.test(term)) return [];
    try {
      // 先看开关再查缓存：开关切换立即生效，不沿用缓存中的扩展结果
      if (!(await this.aiConfig.semanticSearchEnabled())) return [];
      const cached = this.cache.get(term);
      if (cached && cached.exp > Date.now()) return cached.terms;
      const terms = await this.expand(term);
      this.putCache(term, terms);
      return terms;
    } catch (e) {
      // 搜索是高频路径，AI 挂了只降级不报错
      this.logger.warn(`搜索词扩展失败（降级为普通搜索）: ${e instanceof Error ? e.message : e}`);
      this.putCache(term, []);
      return [];
    }
  }

  /** 品名词表（申请明细品名按出现次数降序 + 物品目录名），扩展词只能取自其中 */
  async vocabulary(): Promise<string[]> {
    if (this.epoch !== maintenance.epoch) {
      this.cache.clear();
      this.vocabCache = null;
      this.epoch = maintenance.epoch;
    }
    if (this.vocabCache && this.vocabCache.exp > Date.now()) return this.vocabCache.names;
    const [lineNames, products] = await Promise.all([
      this.prisma.procurementLine.groupBy({
        by: ['itemName'],
        _count: { _all: true },
        orderBy: [{ _count: { itemName: 'desc' } }, { itemName: 'asc' }],
        take: 300,
      }),
      this.prisma.catalogProduct.findMany({
        select: { name: true },
        distinct: ['name'],
        orderBy: { id: 'desc' },
        take: 200,
      }),
    ]);
    const names = [
      ...new Set([...lineNames.map((g) => g.itemName), ...products.map((p) => p.name)]),
    ];
    this.vocabCache = { names, exp: Date.now() + VOCAB_TTL_MS };
    return names;
  }

  private async expand(term: string): Promise<string[]> {
    const cfg = await this.aiConfig.getConfig();
    const vocab = await this.vocabulary();
    if (vocab.length === 0) return [];

    const res = await this.llm.chat({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages: [
        {
          role: 'system',
          content:
            '你是采购申请与库存的搜索助手。下面给出系统现有品名词表与用户搜索词。' +
            '从词表中选出与搜索词指同一种或相近物品的名称（忽略词表中已包含搜索词字面的项）。' +
            '只输出 JSON：{"terms": ["..."]}，最多 ' +
            MAX_SYNONYMS +
            ' 个；没有合适的输出空数组。',
        },
        {
          role: 'user',
          content: JSON.stringify({ 词表: vocab.slice(0, 300), 搜索词: term }),
        },
      ],
      schema: {
        type: 'object',
        properties: { terms: { type: 'array', items: { type: 'string' }, maxItems: 8 } },
        required: ['terms'],
        additionalProperties: false,
      },
      temperature: 0,
      maxTokens: 512,
      timeoutMs: 20_000,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(res.content ?? '');
    } catch {
      return [];
    }
    const terms = (parsed as { terms?: unknown }).terms;
    if (!Array.isArray(terms)) return [];
    return [...new Set(terms.filter((t): t is string => typeof t === 'string'))]
      .filter((t) => vocab.includes(t) && t !== term && !t.includes(term))
      .slice(0, MAX_SYNONYMS);
  }

  private putCache(term: string, terms: string[]): void {
    if (this.cache.size > 200) this.cache.clear();
    this.cache.set(term, { terms, exp: Date.now() + CACHE_TTL_MS });
  }
}
