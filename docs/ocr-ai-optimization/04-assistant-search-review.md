# 04 只读问答、语义搜索与 OCR 校对

目标：问答提示词补齐日期、歧义、轮次与输出格式规则，工具结果结构化压缩；语义搜索缓存随词表失效；删除没有入口且契约过时的 OCR 校对接口。

## 1. 问答 system 提示词修订（`apps/server/src/ai/ai-tools.ts` `systemPrompt`）

现有 8 条规则保留原文（测试固定了"缺失价格表示未知""不能相加""不能新增、修改、撤销"），在第 2 条后插入与末尾追加：

```
2a. 相对日期按今天日期换算：本周为周一至今天；本月为 1 日至今天；上月为上月 1 日至月末；本季度、今年同理。回答时写出实际使用的日期区间。
2b. 最多 6 轮工具调用。统计类问题先用 query_workflow_reports 取汇总，再按需要用其他工具钻取；一次只调用回答所需的工具，不重复查询相同参数。
2c. 品名关键字命中多个物品（品名、规格或单位不同）时，先列出候选并询问用户要哪一个，不要自行选择。
9. 列表用 Markdown 表格，最多 20 行；超出时说明总数并提示到对应页面查看。金额两位小数，数量和单价保留工具返回的原值字符串。
10. 工具结果带 truncated 为 true 时，说明结果被截断，并建议缩小日期范围、指定物品或供应商后再查。
```

`todayString()` 已在第一句给出今天日期，不改。

## 2. 工具结果压缩（`ai.service.ts`，替代截字符串）

1. 序列化前先精简：递归去掉值为 `null`、空字符串、空数组的字段；去掉附件列表、`createdAt`、`updatedAt`、审计字段；单据与申请的 `lines` 每张最多保留 20 行，超出时在该对象上加 `linesTruncated: true`。
2. 精简后仍超过 16000 字符：把 `items` 从后往前删到不超限，`truncated: true`，并附 `hint: "缩小日期范围或减少 pageSize"`；保证返回的是合法 JSON。
3. `query_stock` 的 `limit` 默认 50 改为 30，`query_documents` 默认 `pageSize` 20 改为 10；工具描述同步更新。
4. 工具描述补充参数示例："search 支持单个关键字，如『签字笔』或『综合管理部』，不支持多个关键字"。

## 3. 语义搜索（`ai-search.service.ts`）

- 缓存键改为 `term + ':' + 词表哈希`，词表变化后旧扩展结果立即失效；词表哈希随 `vocabulary()` 缓存一起计算。
- 提示词补一句："不要选择只是同类别但明显不同的物品，如签字笔和荧光笔。"
- `temperature: 0` 在 02 第 4 节修正后才真正生效；保留。

## 4. 删除 OCR 校对接口

前端没有入口，提示词只给 OCR JSON 不给原件图，契约仍建议导入已不收集的单价且没有规格和单位；"AI 重试指定页"已覆盖它的用途。删除清单：

| 位置 | 内容 |
| --- | --- |
| `apps/server/src/ai/ai.controller.ts` | `POST ocr-review` 路由与相关导入 |
| `apps/server/src/ai/ai.service.ts` | `ocrReview`、`diffAgainst`、`removeNulls` 中只为其服务的部分、`ImportsService` 注入（若无其他使用） |
| `packages/shared/src/schemas.ts` | `aiOcrReviewSchema`、`aiOcrReviewResultSchema` 及类型导出 |
| `apps/web/src/api/index.ts` | `ocrReview` 与类型导入 |
| `apps/web/src/components/ai/AiPanel.spec.ts` | `ocrReview` 的 mock |
| `apps/server/test/ai.spec.ts` | 相关用例（如有） |
| `docs/upgrade-2026-09.md` | 接口清单中若列出该接口则删除 |
| `CHANGELOG.md` | 记录删除 |

审计动作 `AI_OCR_REVIEW` 的历史记录保留，不迁移。

## 5. 测试

- `apps/server/test/ai-workflow-tools.spec.ts`：新增短语断言"相对日期""最多 6 轮""先列出候选"；现有短语不动。
- `apps/server/test/ai.spec.ts`：压缩后仍是合法 JSON；`linesTruncated`、`truncated` 与 `hint`；`ocr-review` 返回 404。
- `apps/server/test/ai-search` 相关用例：词表变化后缓存失效。
- 前端：`AiPanel.spec.ts` 去掉 mock 后通过。

## 6. 验收

- 问答在"上月采购了多少办公椅"这类问题上写出日期区间且只调用 1 到 2 次工具（人工抽查 10 个问题）。
- 大结果集问题不再出现模型解析失败的回答。
- 删除接口后类型检查、lint、全部测试通过。
