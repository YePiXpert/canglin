# 05 评测、版本管理、任务清单与回退

## 1. 评测集

- 工具：`scripts/evaluate-imports.py`。manifest 是 JSON 数组，每个样本 `{"id","split":"development"|"holdout","gold":[行],"runs":{"变体名":{"rows":[行],"humanEdits":数,"reviewSeconds":数}}}`，行为 `{"sourceRowId","itemName","spec","unit","quantity","unitPrice"}`，`sourceRowId` 按物理行独立标注，不按品名匹配。
- 改动：`VARIANTS` 不再写死，从 manifest 顶层 `variants` 数组或 `--variants` 参数读取；基线变体名由 `--baseline` 指定（默认 `fixed_old`）。`scripts/tests/test_evaluate_imports.py` 同步。
- 门槛不变：30 到 50 份样本，留出集不少于三分之一；新变体在漏行、多行、品名、单位、规格、数字错误率上都不高于基线；人工修改次数或核对时长至少一项优于基线；留出集达标才算效果成立。
- 种子：本批 13 份原件（30 行）先做开发集，`gold` 按 01 第 3 节的字段规则标注（`itemName` 为名称单元格原文；AI 审核模式另标一份拆分后的 `itemName/spec` 作为 `review` 变体的 gold）。继续收集到 30 份以上，优先补截图与手机照片，并把其中三分之一划为留出集，划分后不再改动。
- 变体名：`fixed_old`（当前解析器）、`grid_v1`（01）、`ai_recognition_v1`（当前提示词）、`ai_recognition_v2`、`ai_review_v1`。
- 脱敏：经办人、审批人姓名替换为"张某""李某"等占位，审批时间戳保留格式改为固定日期，链接中的 `jsessionid` 与跟踪参数截去；部门、品名、数量保留。脱敏后的夹具可入库（01 第 7 节），原件 PDF 与未脱敏 manifest 放在仓库外的 `state/eval/`（`.gitignore` 已覆盖 `state/`，需确认）。

## 2. 版本管理

- `apps/server/src/ai/prompts.ts` 导出所有提示词与版本常量；修改提示词必须改版本号；`CHANGELOG.md` 记录版本变化。
- `AiCall` 新增 `promptVersion`、`mode`，`ParseResult.parserVersion` 网格路径为 `4`、AI 路径为 `ai-primary-2`；评测报告按版本汇总。
- `aiCapabilities` 记录模型拒绝的参数（`temperature`、`reasoning`），配置指纹变化时重新检测。

## 3. 数据库

单次迁移 `add_ai_call_prompt_version`：`AiCall` 加 `promptVersion String?`、`mode String?`，均可空，不回填。只增不删，回退代码不需要回退迁移。

## 4. 任务清单

| 编号 | 任务 | 文档 | 主要文件 | 规模 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| T1 | 网格重建模块与 `parse_pdf` 接入、开关、续页 | 01 §1-2 | `apps/ocr/app/grid.py`、`pipeline.py` | L | — |
| T2 | 噪音清单、单据头标签规则、正则放宽 | 01 §4-5 | `reconstruct.py` | S | — |
| T3 | 列映射、备注解释、`amount` 校验、`spec` 合并 | 01 §3 | `reconstruct.py`、`normalize.py`、`schemas.ts` | M | T1 |
| T4 | 13 份脱敏夹具与 pytest 用例、`Page` 替身补属性 | 01 §7 | `apps/ocr/tests/` | M | T1-T3 |
| T5 | `temperature`、`reasoning`、`max_output_tokens`、`incomplete_details`、多图消息 | 02 §4 | `llm.client.ts`、`ai-config.service.ts` | S | — |
| T6 | 契约 v2：删 `reason`，加 `rawText`、`amount`、`templateType`，日期正则 | 02 §3 | `import-result.ts`、`schemas.ts` | S | — |
| T7 | `existingRows` 精简 | 02 §2.3 | `import-recognition.service.ts` | S | — |
| T8 | `/page` 预处理：EXIF、缩放、JPEG、MIME；服务端不再透传原图 | 02 §5 | `apps/ocr/app/pipeline.py`、`main.py`、`ocr.client.ts` | S | — |
| T9 | `prompts.ts` 与识别模式 v2 提示词、用户消息构造 | 02 §2.1、2.3 | `prompts.ts` | M | T6 |
| T10 | 审核模式：`/parse?mode=text`、分流、服务端校验、`promptVersion` 与 `mode` 入库 | 02 §1、3 | `import-recognition.service.ts`、`ocr.client.ts`、`main.py`、prisma | L | T1、T5、T6、T9 |
| T11 | 问答提示词修订、工具结果压缩、默认分页 | 04 §1-2 | `ai-tools.ts`、`ai.service.ts` | M | T5 |
| T12 | 删除 OCR 校对接口 | 04 §4 | 见清单 | S | — |
| T13 | 评测脚本变体参数化、manifest 种子、脱敏流程 | 05 §1 | `scripts/evaluate-imports.py` | M | T4 |
| T14 | 长截图分段与多图识别 | 02 §7 | `pipeline.py`、`main.py`、`import-recognition.service.ts` | M | T5、T8、T9 |
| T15 | OCR 路径列归属、两行表头、续行、置信度、数字归一 | 03 §2-5 | `reconstruct.py`、`normalize.py` | M | T2、T3 |
| T16 | 品名归一建议 | 02 §9 | `prompts.ts`、`import-recognition.service.ts`、前端 | M | T10 |
| T17 | 语义搜索缓存键与提示词补句 | 04 §3 | `ai-search.service.ts` | S | — |
| T18 | Paddle 参数、照片预处理、真实容器验证 | 03 §6 | `ocr.py`、`main.py` | M | T15 |
| T19 | 文档与发布：README 的 AI 能力段、`upgrade-2026-09.md` 接口与识别说明、`CHANGELOG.md`、版本号 | — | `docs/`、`README.md` | S | 各批次末 |

规模：S 半天内，M 一到两天，L 三天以上，均含测试。

## 5. 批次执行

| 批次 | 任务 | 出口条件 |
| --- | --- | --- |
| 一 | T1、T2、T3、T4、T5、T6、T7、T8、T19 | 13 份原件 30/30 行、52/52 单据头字段；pytest、`pnpm test`、浏览器测试通过；镜像构建通过 |
| 二 | T9、T10、T11、T12、T13、T19 | 真实服务下 13 份审核模式全部返回合法 JSON 且数量、链接与网格一致；开发集评测 `grid_v1` 与 `ai_review_v1` 不低于 `fixed_old`；问答抽查 10 问通过 |
| 三 | T14、T15、T16、T17、T18、T19 | 留出集评测达标；真实容器冒烟记录；长截图与照片样本人工核对 |

每批在开发集跑评测，再看留出集，达标后写 CHANGELOG 并按 [升级说明](../upgrade-2026-09.md) 发布；真实服务验收另记发布记录。

## 6. 回退开关

| 范围 | 开关 | 行为 |
| --- | --- | --- |
| 网格重建 | 环境变量 `OCR_GRID_REBUILD=0` | `parse_pdf` 跳过网格重建，走原有 `find_tables` 与逐行正则 |
| 审核模式 | 设置 `aiConfig.reviewTextPdf`（默认开） | 关闭后文本层页面也走识别模式；网格结果仍作为本地结果 |
| 提示词 | 改回旧版本常量 | 调用记录的 `promptVersion` 区分新旧 |
| 调用参数 | `reasoningEffort` 设为"不发送" | 请求体不含 `reasoning` 与 `temperature` |
| 图像预处理 | 环境变量 `OCR_PAGE_PREPROCESS=0` | `/page` 只做渲染与缩放，不转 JPEG |
| 照片 OCR 预处理 | 环境变量 `OCR_PHOTO_PREPROCESS=0` | 不做灰度与对比度处理 |
| 数据库 | 不需要 | 新字段可空 |

## 7. 风险

- 网格重建依赖 OA 打印页的边框对象；OA 升级后版式变化会让表头或竖线识别失败，此时自动退回旧路径并带警告"未识别到表格边框"，评测集能及时发现。
- 第三方 Responses 服务对 `reasoning`、`temperature`、多图的支持不一，退让逻辑只处理 400，其他错误仍按现有失败流程。
- 审核模式每页多一次 AI 调用成本；预算与计价逻辑不变，设置页说明"文本层 PDF 也会调用模型做核对"。
- 品名归一建议可能诱导管理员合并不该合并的物品；只做建议，界面显示原文，并在审计中记录采用动作。
