import { FinanceService } from '../execution/finance.service';
import { ExceptionsService } from '../execution/exceptions.service';
import { BatchesService } from '../execution/batches.service';
import { executionQuerySchema } from '@canglin/shared';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  WORKFLOW_DOCUMENT_KINDS,
  WORKFLOW_STAGES,
  workflowDateSchema,
  type WorkflowQuery,
} from '@canglin/shared';
import { SuppliersService } from '../suppliers/suppliers.service';
import { WorkflowQueryService } from '../workflow/workflow-query.service';
import { todayString } from '../common/date.util';
import type { ToolDef } from './llm.client';

const workflowDates = { dateFrom: workflowDateSchema.optional(), dateTo: workflowDateSchema.optional() };
const orderedDates = (value: { dateFrom?: string; dateTo?: string }) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo;
const workflowPaging = {
  search: z.string().trim().max(100).optional(),
  requestId: z.number().int().positive().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
};
const queryRequestsArgs = z.object({
  ...workflowDates,
  ...workflowPaging,
  productId: z.number().int().positive().optional(),
  stage: z.enum(WORKFLOW_STAGES).optional(),
  pending: z.boolean().optional(),
}).strict().refine(orderedDates, '起始日期不能晚于结束日期');
const queryDocumentsArgs = z.object({
  ...workflowDates,
  ...workflowPaging,
  // 单据带多行明细，单页条数少一些，避免结果超过回传上限
  pageSize: z.number().int().min(1).max(50).default(10),
  kind: z.enum(WORKFLOW_DOCUMENT_KINDS).optional(),
  productId: z.number().int().positive().optional(),
  supplierId: z.number().int().positive().optional(),
}).strict().refine(orderedDates, '起始日期不能晚于结束日期');
const queryStockArgs = z.object({
  search: z.string().trim().max(100).optional(),
  productId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(30),
}).strict();
const queryWorkflowReportsArgs = z.object({
  ...workflowDates,
  groupBy: z.enum(['month', 'department', 'supplier']).default('month'),
}).strict().refine(orderedDates, '起始日期不能晚于结束日期');
const requestUrl = (id: number | null) => id === null ? null : `/requests/${id}`;
const executionPaging = { search: z.string().trim().max(100).optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().min(1).max(50).optional() };
const settlementArgs = z.object({ ...executionPaging, supplierId: z.number().int().positive().optional(), documentId: z.number().int().positive().optional() }).strict();
const exceptionArgs = z.object({ ...executionPaging, status: z.enum(['ACTIVE', 'SNOOZED', 'IGNORED', 'RESOLVED', 'ALL']).optional() }).strict();
const demandArgs = z.object(executionPaging).strict();

/** 交给 LLM 的工具清单：全部只读，直接复用现有查询服务 */
@Injectable()
export class AiToolsService {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly workflow: WorkflowQueryService,
    private readonly finance: FinanceService,
    private readonly exceptions: ExceptionsService,
    private readonly batches: BatchesService,
  ) {}

  definitions(): ToolDef[] {
    const dates = {
      dateFrom: { type: 'string', description: '日期起 YYYY-MM-DD，含当天' },
      dateTo: { type: 'string', description: '日期止 YYYY-MM-DD，含当天' },
    };
    const paging = {
      requestId: { type: 'integer', description: '申请 ID，精确匹配' },
      page: { type: 'integer', minimum: 1, description: '默认 1' },
      pageSize: { type: 'integer', minimum: 1, maximum: 50, description: '默认 20；返回 total 可判断是否还有下一页' },
    };
    const tool = (name: string, description: string, properties: Record<string, unknown>): ToolDef => ({
      type: 'function', function: { name, description, parameters: { type: 'object', properties, additionalProperties: false } },
    });
    return [
      tool('query_settlements', '查询采购金额对账，包含净实付、待付款、待退款、员工报销及发票匹配。LEGACY 的空金额表示尚未核实，不能推算。', { search: { type: 'string' }, supplierId: { type: 'integer' }, documentId: { type: 'integer' }, page: paging.page, pageSize: paging.pageSize }),
      tool('query_exceptions', '查询站内异常，含来源链接和人工处理状态。只读，不变更提醒或业务。', { search: { type: 'string' }, status: { type: 'string', enum: ['ACTIVE','SNOOZED','IGNORED','RESOLVED','ALL'] }, page: paging.page, pageSize: paging.pageSize }),
      tool('query_monthly_review', '查询指定月份采购、实际资金、供应商交付、个人净领用及当前长期未领用库存，注意月份和当前快照口径。', { month: { type: 'string', description: 'YYYY-MM' } }),
      tool('query_purchase_demands', '查询剩余采购需求和已有批次草稿，保留申请来源；整理或操作请引导用户到集中采购建立人工核对草稿。', { search: { type: 'string' }, page: paging.page, pageSize: paging.pageSize }),
      tool('query_requests', '查询申请（OA 审批单导入或人工录入）及每条物理明细的进度、待采购/到货/处理数量。日期按申请日期过滤，同名不同规格/单位分别保留。autoSerial 为 true 的申请没有 OA 单号，流水号是系统编号「无OA-日期-序号」；补填 OA 流水号后 systemSerial 仍是原系统编号。', {
        search: { type: 'string', description: '流水号/品名/部门/经办人关键字；只支持单个关键字，如『签字笔』或『综合管理部』，不支持多个关键字' },
        ...paging, ...dates,
        productId: { type: 'integer', description: '筛选包含该物品 ID 的申请；整份申请仍返回所有物理行，按品名/规格/单位区分' },
        stage: { type: 'string', enum: [...WORKFLOW_STAGES], description: '申请包含此阶段明细；一个申请可同时包含多个阶段' },
        pending: { type: 'boolean', description: 'true 只看有待办明细的申请' },
      }),
      tool('query_documents', '查询分次采购、收货、入库、直发/库存领用、供应商退货、员工归还、取消、库存调整单据。日期按单据业务日期过滤；注意 POSTED 有效、VOIDED 已撤销。供应商成交价、付款/报销状态、发票及来源 ID 在单据中。', {
        search: { type: 'string', description: '供应商/品名/领用人关键字；只支持单个关键字，如『签字笔』，不支持多个关键字' },
        ...paging, ...dates,
        pageSize: { type: 'integer', minimum: 1, maximum: 50, description: '默认 10；返回 total 可判断是否还有下一页' },
        kind: { type: 'string', enum: [...WORKFLOW_DOCUMENT_KINDS] },
        productId: { type: 'integer', description: '筛选包含该物品 ID 的单据；整张单据仍返回所有行，按品名/规格/单位区分' },
        supplierId: { type: 'integer', description: '供应商 ID，来自 query_suppliers' },
      }),
      tool('query_stock', '查询按品名+规格+单位区分的当前待处理量和库存量，以及采购/收货来源和来源单价。不同物品单位不能相加。', {
        search: { type: 'string', description: '品名/规格关键字；只支持单个关键字，如『签字笔』，不支持多个关键字' },
        productId: { type: 'integer', description: '物品 ID，精确匹配' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '默认 30，truncated 表示还有结果；可按物品进一步查询' },
      }),
      tool('query_workflow_reports', '查询有效单据的成交额、撤单额、退款额、净成交额、收货额及退货后的净收货额，并按月份/部门/供应商分组；领用与员工归还按领用人+物品身份分别统计。日期按各业务事件发生日期，统计问题优先用此工具。', {
        ...dates,
        groupBy: { type: 'string', enum: ['month', 'department', 'supplier'], description: '默认 month' },
      }),
      tool('query_suppliers', '列出现有供应商及联系方式，先核对供应商名称再查询相关采购单据。', {}),
    ];
  }

  /** 执行一次工具调用；返回值会 JSON 序列化后回给 LLM */
  async execute(name: string, args: Record<string, unknown>): Promise<{ result: unknown; count: number }> {
    switch (name) {
      case 'query_settlements': { const q = executionQuerySchema.parse(settlementArgs.parse(args)); const result = await this.finance.settlements(q); return { result: { ...result, items: result.items.map(r => ({ ...r, url: `/finance?documentId=${r.documentId}` })) }, count: result.items.length }; }
      case 'query_exceptions': { const result = await this.exceptions.list(executionQuerySchema.parse(exceptionArgs.parse(args))); return { result, count: result.items.length }; }
      case 'query_purchase_demands': { const result = await this.batches.demands(executionQuerySchema.parse(demandArgs.parse(args))); return { result: { ...result, url: '/procurement' }, count: result.items.length }; }
      case 'query_monthly_review': { const { month } = z.object({ month: z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/) }).strict().parse(args); const result = await this.exceptions.monthly(month); return { result: { ...result, url: `/insights/monthly?month=${month}` }, count: 1 }; }

      case 'query_requests': {
        const a = queryRequestsArgs.parse(args);
        const query: WorkflowQuery = { ...a, pending: a.pending ? '1' : undefined };
        const page = await this.workflow.requests(query);
        return { result: { ...page, items: page.items.map((row) => ({ ...row, requestUrl: requestUrl(row.id) })) }, count: page.items.length };
      }
      case 'query_documents': {
        const a = queryDocumentsArgs.parse(args);
        const page = await this.workflow.documents(a);
        return {
          result: { ...page, items: page.items.map((row) => ({
            ...row,
            lines: row.lines.map((line) => ({ ...line, requestUrl: requestUrl(line.requestId), stockUrl: '/stock' })),
          })) },
          count: page.items.length,
        };
      }
      case 'query_stock': {
        const { limit, ...query } = queryStockArgs.parse(args);
        const rows = await this.workflow.stock(query);
        const products = rows.slice(0, limit).map((row) => ({
          ...row, stockUrl: '/stock',
          sources: row.sources.map((source) => ({ ...source, requestUrl: requestUrl(source.requestId) })),
        }));
        return { result: { products, total: rows.length, truncated: rows.length > limit }, count: products.length };
      }
      case 'query_workflow_reports': {
        const a = queryWorkflowReportsArgs.parse(args);
        const report = await this.workflow.reports(a);
        return {
          result: {
            ...report,
            dateFrom: a.dateFrom ?? null, dateTo: a.dateTo ?? null, groupBy: a.groupBy,
            basis: {
              date: '各业务事件的单据日期，仅统计 POSTED；取消和退货记入自身发生日期',
              netPurchaseAmount: 'grossPurchaseAmount - cancelledPurchaseAmount - refundedPurchaseAmount；换货不扣成交额',
              netReceiptAmount: 'grossReceiptAmount - supplierReturnAmount；不能与采购金额相加',
              recipients: '按领用人、部门、物品 ID（品名+规格+单位）区分，净领用=发放-员工归还',
            },
            reportUrl: '/insights',
          },
          count: 1,
        };
      }
      case 'query_suppliers': {
        z.object({}).strict().parse(args);
        const suppliers = await this.suppliers.list();
        return {
          result: suppliers.map((s) => ({
            id: s.id,
            name: s.name,
            contact: s.contact,
            phone: s.phone,
            documentCount: s._count.businessDocuments,
          })),
          count: suppliers.length,
        };
      }
      default:
        throw new Error(`未知工具 ${name}`);
    }
  }

  /** 问答的 system 提示词：领域说明 + 回答规则 */
  systemPrompt(): string {
    return [
      '你是「仓廪」办公用品业务的只读查询助手。今天日期 ' + todayString() + '。',
      '业务模型：申请来自 OA 审批单，或没有 OA 单号、打过招呼先采购的人工录入（流水号以「无OA-」开头），保留物理明细，以品名+规格+单位区分物品；每条可分次、多供应商、不同成交价采购，部分收货后直发或入库，库存再领用。另有供应商退货、员工归还及撤销/取消。',
      '新增资金、退款、报销和票据金额用 query_settlements；历史 LEGACY 不推算金额。异常用 query_exceptions，月度汇总用 query_monthly_review。用户要求整理采购或匹配发票时，引导到 /procurement 或 /finance/invoices 生成可编辑草稿，必须人工核对并执行；你没有写入工具。',
      '回答规则：',
      '1. 申请与待办查询用 query_requests，供应商/价格/付款报销/发票/领用/退回明细用 query_documents，当前待处理量和库存用 query_stock，统计优先用 query_workflow_reports。',
      '2. 所有数字、状态和来源 ID 必须来自工具结果；没有数据就明确说明。总条数用 total，页内明细不能代表全量；truncated 时说明结果截断或进一步查询。',
      '2a. 相对日期按今天日期换算：本周为周一至今天；本月为 1 日至今天；上月为上月 1 日至月末；本季度、今年同理。回答时写出实际使用的日期区间。',
      '2b. 最多 6 轮工具调用。统计类问题先用 query_workflow_reports 取汇总，再按需要用其他工具钻取；一次只调用回答所需的工具，不重复查询相同参数。',
      '2c. 品名关键字命中多个物品（品名、规格或单位不同）时，先列出候选并询问用户要哪一个，不要自行选择。',
      '3. 数量和单价是精确小数字符串，保留原值。不同品名、规格或单位的数量分别列出，不能合计成一个数量，也不能将待处理量当库存量。',
      '4. 申请数量不等于成交额。成交价以采购单据行 unitPrice/amount 为准，缺失价格表示未知，不按零估算；totalAmount 为 null 的领用等单据没有成交额。',
      '5. 金额统计引用工具 grossPurchaseAmount/取消额/退款额/netPurchaseAmount 或 grossReceiptAmount/退货额/netReceiptAmount，说明口径和日期范围；采购额与收货额反映不同环节，不能相加。退款扣净成交额，换货不扣；撤销单据不计入汇总。',
      '6. 付款/报销状态和 invoiceIssued 只是记录状态，不能推算实付额或报销额；发票附件仅按实际返回附件说明。',
      '7. 用简体中文简洁回答，金额展示两位小数。涉及具体业务时引用申请流水号、申请 ID、单据 ID 或来源行 ID，并使用工具返回的 requestUrl/stockUrl/reportUrl 链接，禁止编造链接。',
      '8. 你只能查询，不能新增、修改、撤销、删除或确认入账。用户提出操作时引导打开相应业务页面。',
      '9. 列表用 Markdown 表格，最多 20 行；超出时说明总数并提示到对应页面查看。金额两位小数，数量和单价保留工具返回的原值字符串。',
      '10. 工具结果带 truncated 为 true 时，说明结果被截断，并建议缩小日期范围、指定物品或供应商后再查。',
    ].join('\n');
  }
}
