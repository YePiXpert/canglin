# 01 文本层 PDF 网格重建

目标：有文本层的 OA 打印 PDF 不经 OCR、不经 AI，按表格边框和词坐标恢复物理行与列，明细行零漏零多，字段逐字正确。算法已在 13 份原件上验证（[prototype-grid-rebuild.py](./prototype-grid-rebuild.py)，30/30 行）。

## 1. 适用条件与接入点

- 接入 `apps/ocr/app/pipeline.py` 的 `parse_pdf`：每页先判断 `scanned`（现有规则，大图占页面 20% 以上）；未扫描且文本层字符数不少于 20 时，先调用网格重建；成功（表头识别成功且至少 1 行，或续页识别成功）就采用，`mode` 为 `PDF_TEXT`，`parserVersion` 升为 `4`；失败再走现有 `find_tables` 和逐行正则。
- 文本层存在但没有表格的页面（审批记录页、附件说明页）不再触发 OCR 回退；只有 `scanned` 或字符数少于 20 的页面才渲染后 OCR。现有逻辑在"文本页无明细"时也会启动 Paddle，是无谓的耗时。
- 续页：本页没有表头时，若上一页的表尚未结束（未遇到停止词），沿用上一页的列定义；`parse_pdf` 按页顺序处理，`page_number` 单页请求时需要先解析上一页的列定义（只取列定义，不输出其明细）。
- 开关：环境变量 `OCR_GRID_REBUILD`（默认 `1`），为 `0` 时跳过网格重建，用于回退。

## 2. 算法

参数都是 pt（pdfplumber 坐标），来自 13 份原件实测，实现时作为模块常量。

1. 词：`page.extract_words(x_tolerance=1.5)`；丢弃 `top < 30` 或 `top > 页高 - 40` 的词（浏览器打印页眉"print / Page x of y"与页脚 print.jsp 链接和打印日期）。
2. 表头锚点：文本属于名称关键字（见第 3 节键表）且上下 7pt 内有数量关键字的词。表头词集合是锚点上下 7pt 内的全部关键字词，这样两行表头"规格/型号""生产/厂家"一并纳入。`body_top` 等于表头词最大 `bottom` 加 2。
3. 停止：`body_top` 以下第一个匹配 `^(插入项|合计|总金额)` 的词，其 `top` 减 1 为 `bottom`；没有停止词时 `bottom` 取页高减 40，并把表标记为"未结束"供续页使用。
4. 竖线：`page.edges` 中 `orientation == 'v'` 的边，按 `x0` 聚类，容差 6。每簇的覆盖度是各线段与区间 `[body_top, bottom]` 重叠长度之和，覆盖度不少于区间高度一半的簇保留。必须用重叠之和而不是簇的并集范围：表单"标签 | 值"的分隔线在表格区域内没有线段但并集跨过整个表格；固定资产单的表头没有竖线，列线只来自数据行的输入框。
5. 列区间：相邻保留竖线之间。表头词按中心点落入的区间取得列键；没有键的窄区间（输入框内边与单元格边线之间的几个 pt）不单独成列。词归列时取与有键区间水平重叠最大的那一列，重叠为零时取距离最近的。
6. 横线：`orientation == 'h'` 且 `top` 在 `[body_top - 6, bottom + 6]` 内的边，按 `top` 聚类，容差 4。簇的 x 范围需从表左边线减 10 之内开始、到表右边线减 10 之外结束，并且起点不早于表左边线减 10（排除页面外框和页脚分隔线）。
7. 行区间：相邻横线之间，高度不足 6 的跳过。格内词先按 `top` 分行（容差 3），行内词用空格连接，行与行之间不加分隔符拼接。这一条还原"SF-CH-23"+"06A黑框"、"M552d"+"n M553n"、以及拆成 9 行的链接。
8. 续行合并：序号列不是整数且数量列不是数字的行并入上一行，各列文本直接拼接。固定资产单的第二行型号、领用单内的输入框横线都靠这一条合并。
9. 续页：本页无表头且上一页未结束时，直接使用上一页的列 x 与键，`body_top` 取本页第一个词的 `top` 减 2，其余步骤相同。
10. 来源：每行的 `source.box` 取该行所有词的外接矩形并按页宽页高归一化，`source.method` 为 `PDF_TEXT`，`source.rawText` 为名称单元格原文；`confidence` 为空（文本层没有置信度）。

## 3. 列键与字段映射

表头关键字到列键：

| 关键字 | 键 |
| --- | --- |
| 物品名称、资产名称、品名、名称 | name |
| 序号 | idx |
| 数量、申领数量 | qty |
| 单价、预计单价 | price |
| 预计总价、金额、总价 | amount |
| 备注 | note |
| 规格、型号、规格型号 | spec |
| 主要技术指标 | spec2 |
| 生产、厂家、生产厂家、品牌 | brand |
| 类别 | cat |
| 单位 | unit |
| 链接、网址 | url |

映射到 `parsedItemSchema`：

| 字段 | 规则 |
| --- | --- |
| itemName | name 原文，逐字保留，不在这一层拆分规格（拆分由 AI 审核模式或人工完成；`rawText` 同值） |
| quantity | qty 转数字，"10.0" 记 10；全角转半角，去千分位；非数字留 null 并警告"第 N 行未识别到数量" |
| unit | 有 unit 列取之；否则 note 匹配 `^(\d+(?:\.\d+)?)\s*(单位)$` 且数值等于数量时取单位；note 匹配 `^(一|两|二|三|四|五|六|七|八|九|十)(单位)$` 且中文数字等于数量时取单位；名称末尾 `(单位：X)` 或 `（单位:X）` 取 X。都不满足留 null |
| unitPrice | price 转数字；空、0、"0.00" 记 null |
| amount | amount 转数字（契约新增字段，见 02 第 4 节）；quantity、unitPrice、amount 三者齐全而乘积与 amount 相差超过 0.01 时警告"第 N 行数量×单价与金额不符" |
| spec | spec、spec2、brand 原文按顺序用"；"连接并去重，"无""-""/"视为空；cat（如"非电子类"）不进 spec |
| purchaseLink | url 列，或 note 以 http(s) 开头时取 note（已按第 2 节第 7 条拼接，不含空格与换行）；长度超过 500 截断并警告 |
| 备注其余文字 | note 既不是链接也不能解释为单位时（如"Hp m233dn，203dn，202d 三种型号各两个"）追加进 spec，并警告"第 N 行备注『…』未能解释为单位，请核对是否需要拆行" |

单位正则沿用 `normalize.py` 的 `UNIT_RE`，补充"盘、副、卷、提、刀、令、打、筒、罐、瓶、袋、桶、块、颗、粒、份、箱、包、盒、支、个、只、本、册、张、条、根、套、台、件、把、双、对、枚"。

## 4. 单据头

- 模板：标题词"办公用品领用单"记 `templateType = OFFICE_SUPPLY`，"固定资产购买申请单"记 `FIXED_ASSET`，其余 `GENERIC`。`parseResultSchema` 新增可选字段 `templateType`。
- 标签取值：标签词右侧、同一基线（`top` 相差 6 以内）、`x0` 大于标签 `x1` 的第一组词是值；若该组词本身是另一个标签，值为空。值右侧与下一标签之间的全部词属于该值。
- 换行值：值下方 1.3 倍行高内、`x` 范围落在值的 x 范围内且不是标签的词行，按字符拼接到值后面（"综合管理部（董事"+"会办公室）"，"长城开拓-综合管理"+"部"）。
- 标签表：部门 `申领部门|申请单位部门|申请部门|需求部门|使用部门|部门`；经办人 `经办人|申请人|申领人|填报人|发起人|领取人`；日期 `申领日期|申请日期|提交日期|填报日期|单据日期|日期`；单号 `流水号|编号|申请编号|单号`。冒号可有可无。
- 固定资产单：部门取第一个非空的"申请单位部门"值；经办人在页面底部，全页搜索；"编号 202600015 单位：元"中单号是紧随标签的数字串。
- 经办人允许岗位名和括号，长度 2 到 16，允许汉字、字母、数字、括号与"·"。
- 日期只认标签后的 `YYYY-MM-DD`、`YYYY/M/D`、`YYYY年M月D日`；带时间的时间戳（审批记录）和页脚无标签的打印日期不算。
- 现有 `extract_fields` 保留为 GENERIC 与 OCR 路径的兜底，放宽 `DEPARTMENT_LABEL_RE` 的冒号和 `HANDLER_RE` 的字符集。

## 5. 噪音清单

追加到 `reconstruct.py` 的 `UI_NOISE_PATTERNS`，OCR 路径同样生效：

```
^print$
^Page\s*\d+\s*of\s*\d+$
^https?://\S*print\.jsp
^\d{4}/\d{1,2}/\d{1,2}$
^插入项$
^总金额
^归属月份
^合计
^附件$
^单位[:：]\s*元$
^使用范围
^资金来源
^【[^】]{1,6}】$
^\[.{1,12}\s+\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\]$
意\s*见[:：]?$
^(申请|申领)单位?部门$
^(负责人|分管领导)意见$
^（仅限.{0,20}）$
```

## 6. 代码改动

| 文件 | 改动 |
| --- | --- |
| `apps/ocr/app/grid.py`（新） | `rebuild_from_grid(page, carry) -> (state, result)`：第 2 节算法，返回列定义状态与 `{items, warnings, templateType, header}`；纯函数，只依赖 `page.extract_words`、`page.edges`、`page.width`、`page.height`，便于用 JSON 替身测试 |
| `apps/ocr/app/pipeline.py` | `parse_pdf` 接入顺序与开关；文本页无表格时不再 OCR；续页列定义传递；`PARSER_VERSION = "4"` |
| `apps/ocr/app/reconstruct.py` | 噪音清单；`extract_fields` 放宽；新增 `fields_from_words(words)` 实现第 4 节；`rows_from_table` 复用第 3 节的列映射函数 |
| `apps/ocr/app/normalize.py` | `parse_unit_note(note, quantity)`、中文数字、`(单位：X)` 解析、千分位与全角处理 |
| `packages/shared/src/schemas.ts` | `parsedItemSchema` 加 `amount: z.number().finite().nonnegative().nullish()`；`parseResultSchema` 加 `templateType` |
| `apps/server/src/imports/import-result.ts` | `mergePage`、`finishResult` 透传 `templateType`；`draftFrom` 不变 |
| `apps/web` | 明细行悬浮显示 `rawText`；警告按行号分组显示（现有 `ImportRecognitionNotices.vue`） |

## 7. 测试

- 夹具：把 13 份原件每页的 `extract_words` 结果与 `edges`（只保留 `orientation`、`x0`、`x1`、`top`、`bottom`）导出为 JSON，姓名替换为"张某""李某"，存入 `apps/ocr/tests/fixtures/seeyon/`。测试用 `FakePage` 适配器提供 `extract_words`、`edges`、`width`、`height`，直接喂 `rebuild_from_grid`，不依赖 PDF 文件与 pdfplumber 版本。
- 用例：领用单 4 行带备注单位与说明；两页 12 行跨页续行；4 行换行品名；9 行换行链接；固定资产单两行表头与换行型号；页脚链接不成行；"总金额 0.00"不成单价；部门换行拼接；经办人为岗位名；固定资产单经办人在底部；文本页无表格不触发 OCR；`OCR_GRID_REBUILD=0` 走旧路径。
- API 集成：`test_api.py` 增加一份合成文本层 PDF（用 `reportlab` 或预生成的最小 PDF）验证 `/parse` 端到端返回 `templateType` 与 `amount`。
- 现有 `test_pipeline.py` 的 `Page` 替身需补 `extract_words`、`edges` 属性，否则网格重建会先于 `find_tables` 介入并改变既有断言。

## 8. 验收

- 13 份原件：30/30 行；0 假行；`itemName` 与名称单元格原文逐字相同；链接与文本层逐字相同；固定资产单 `spec` 为"型号；厂家"形式、`amount` 校验通过；52/52 单据头字段正确。
- 单页解析耗时 1 秒内（不加载 Paddle）。
- `(cd apps/ocr && pytest)` 全绿；服务端与前端测试不受影响。
