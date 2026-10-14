# 前端 UI 改进方案（2026-10）

## 0. 背景与结论

2026-10-14 对 `apps/web` 做了一轮评估：代码审读、`typecheck / lint / 213 个单测`（当时全绿）、按 DESIGN.md §9 的矩阵实跑截图（1440 / 390 × 浅 / 深色，63 张）和一次逐文件的一致性审计。结论：视觉与响应式已经成熟，桌面、手机、深色都没有穿帮；剩下的改进集中在五块，按优先级排成批次 A–E：

| 批次 | 内容 | 性质 |
| --- | --- | --- |
| A | 交互正确性：会丢数据、把失败当空态、缺确认、重复 alert、导入页阻塞项不可见 | 必做，先做 |
| B | 可访问性与基元：错误关联、对话框描述、焦点圈定、live region、触控尺寸、标题、错误边界 | 必做 |
| C | 工程一致性：重复代码收敛、基元 API 统一、列表上限、零散规范违例 | 尽量做 |
| D | 装饰：克制的线描插画、品牌资产补齐、两处微动效（评估结论见 §5） | 尽量做 |
| E | 测试：视觉回归、核心单测、设置页 e2e | 尽量做 |

执行方式：按 A → B → C → D → E 顺序，每批结束跑 §1 的校验；**不 commit、不 push**，改动留在工作树；每批把结果写进文末 §8「实施记录」。上下文或时间不够时在批次边界停下，保证停下时校验全绿并记录到哪一步。

## 1. 执行规则（必须遵守）

- 设计与写法以 [apps/web/DESIGN.md](../apps/web/DESIGN.md) 为准：§1–§7 是规则，§8 是页面特例，§9 是不做的事。基元（`components/ui`）或令牌的行为变了，在同一次改动里更新 DESIGN.md 对应小节；用户可见行为变了，在 CHANGELOG「未发布」下加一条。
- **不改 e2e / spec 依赖的接口**：文案、`aria-label`、`role`、按钮名、`data-*` 钩子。改任何可见文案或可访问名称前先 `grep -rn` 一遍 `apps/web/e2e` 与 `apps/web/src/**/*.spec.ts`；确需改动时同步改测试，并在实施记录里写明。
- 不新增运行时依赖（UI 库、图标库、字体、网络字体）。缺图标在 `Icon.vue` 补 path；插画用内联 SVG、`currentColor`、令牌色。
- 每项先核对「现状」是否仍成立（行号是 2026-10-14 的，可能漂移）；不成立就跳过并记录原因，不要为了完成清单硬改。
- 只改 `apps/web`，以及 §4 C7 明确允许的服务端分页参数；不读生产配置与密钥，不碰业务规则（撤销回冲、幂等、草稿版本号、原件关联）。
- 每批的校验命令：

```bash
pnpm --filter @canglin/shared build      # 只在改了 packages/shared 时
pnpm --filter @canglin/web typecheck
pnpm --filter @canglin/web lint
pnpm --filter @canglin/web test
```

- 全部批次完成后（或停下前）：

```bash
pnpm --filter @canglin/web build
pnpm --filter @canglin/server build       # e2e 的 API 从 dist 启动
pnpm --filter @canglin/web test:e2e
```

- 截图检查按 DESIGN.md §9：至少工作台、申请详情、导入任务页、设置页，1440 / 390 × 浅 / 深色；环境见 §7。

## 2. 批次 A：交互正确性

### A1 设置页「刷新」丢编辑、失败当空态

- 现状：`apps/web/src/views/SettingsView.vue:47-70` 的 `load()` 每次都把 `autoBackup`、`aiConfig` 换成新对象，`AiSettingsPanel.vue:109-124` 与 `AutoBackupPanel.vue` 对 `initial` 的 watch 立即回填表单，所以系统状态面板的「刷新」会覆盖用户填到一半的 AI 接口地址、Key、备份间隔；刷新没有进行中提示；`:54`、`:56` 用 `.catch(() => [])` / `.catch(() => null)` 吞掉备份列表与 AI 配置的失败，页面显示成「还没有备份」和一张空的 AI 表单；四个请求串行等待。
- 做：刷新只重拉系统状态与 OCR 健康（或：面板表单有未保存改动时不回填，由面板比较 dirty 后决定）；四个请求 `Promise.allSettled` 并行；备份与 AI 配置失败时在各自区块显示 `Notice variant="inline" tone="red"` + `link`「重试」，不再显示假空态；刷新按钮 `loading`。
- 验收：AI 区填了一半，点系统状态「刷新」后内容仍在；让备份接口失败时看到错误与重试，而不是「还没有备份」。

### A2 附件删除无确认、备份删除可重复提交

- 现状：`components/workflow/WorkflowAttachments.vue:72` 点垃圾桶直接删除；`components/settings/BackupManagerPanel.vue:58-68` `removeBackup` 没有 `loading`、没有在途防重。
- 做：附件删除走 `ConfirmDialog`（`danger`，message 写文件名与后果）；备份删除确认框传 `:loading`，在途时忽略重复点击。
- 验收：删附件先看到确认；备份删除连点两次只发一个请求。

### A3 登记类弹窗的旧失败提示不清除

- 现状：`ReceiptRegisterDialog.vue:46-57`、`QuantityCommandDialog.vue`（`save` 约 80–92 行）、`PurchaseRegisterDialog.vue`（约 140–150 行）在客户端校验前不清 `failure`，上一次服务端失败的页脚 alert 会和 `RegisterLineTable` 的行级错误同时存在，页面出现两个 `role="alert"`；`PurchaseRegisterDialog` 供应商加载失败（约 60 行）的提示在重试成功后也不消失。`RequestCreateDialog.vue:87` 已是正确写法。
- 做：校验开始处 `failure.value = ''`；供应商加载成功后清对应错误。
- 验收：先制造一次服务端失败，再改出行级错误，页面只剩一个 alert。

### A4 导入页

- a) 确认按钮不反映阻塞项：`views/ImportView.vue:128-135` 只按「识别中 / 已确认 / 未载入」禁用，「数量未确认，暂不能入账」只标在明细行上，长单子要滚动去找。做：在 `StickyActionBar` 的 `#start` 汇总阻塞项（「还有 N 条明细数量未确认」「N 页未核对」「流水号未填」等，与 `workflowImportConfirmSchema` 的规则一致），有阻塞时按钮 `disabled` 并显示原因；点击时的错误逻辑保留。注意 `e2e/import.spec.ts` 依赖按钮名「确认全部内容并导入」及识别中禁用。
- b) `components/import/useImportTask.ts:88-97` `reloadDraft` 用 `window.confirm`，与 §1 原则 4 冲突。做：改成 `ConfirmDialog`（状态放进 context，由 `ImportView` 渲染）。
- c) `components/import/ImportHistoryPanel.vue`：历史加载没有加载中、失败、空态；`:51` 把 `NOT_SENT / RUNNING / DONE / FAILED` 原样显示；`:58` 费用 `toFixed(6)` 无单位；展开与收起都会重新请求。做：Skeleton / `Notice` + 重试 / 一行空态；状态映射中文（未发送 / 识别中 / 完成 / 失败）；费用显示「¥0.0123」（四位小数，数据本身是四位）或「—」；只在展开时加载、已加载不重复。
- d) `ImportView.vue:118` 与 `:165`：放弃草稿弹窗打开时同一个 `error` 显示两次。做：弹窗内只显示放弃操作自身的错误（单独的 `discardError`）。

### A5 供应商页、账号安全、工作台侧栏

- `views/SuppliersView.vue`：有关联单据（`_count.businessDocuments > 0`）的供应商也能进入删除确认，服务端必然拒绝（`apps/server/src/suppliers/suppliers.service.ts:45`）。做：确认框用 `confirmDisabled` 并说明「已有 N 份单据，不能删除」。成交价格搜索时整张表换成骨架（约 165 行）。做：刷新时保留旧表格，只显示「查询中…」。价格列表无上限，见 C7。
- `components/settings/AccountSecurityPanel.vue:96-110`：空密码、密码错误只用 toast。做：字段级 `error`。
- `components/workflow/RecentDocumentsAside.vue:69`：已有内容时刷新失败没有任何提示。做：参照 `ImportPendingAside.vue:94` 显示一行 inline 错误。

### A6（可选，较大）会话过期原地重登

- 现状：`api/client.ts:36-49` 收到 401 就清登录态并整页跳到 `/login`，弹窗里填到一半的内容丢失（30 分钟无操作后回来提交就会碰到）。
- 做：401 时先弹「会话已过期，请重新登录」的小弹窗（ConfirmDialog 排版 + 密码框，`persistent`），登录成功后重放原请求一次（拦截器里把失败的请求挂起），失败再走现有跳转。路由守卫逻辑不变；e2e 不依赖此流程。若实现超出预期（例如 multipart 上传重放困难），至少对上传类请求保持现状并在记录里写明。

## 3. 批次 B：可访问性与基元

### B1 字段错误与提示关联到控件

- 现状：`components/ui/Input.vue:87-90`、`Textarea.vue`、`Select.vue`、`NativeSelect.vue` 的 `.field-error` 与 hint 没有 id，控件没有 `aria-describedby`，读屏只听到 `aria-invalid`。`Checkbox.vue:103` 是正确写法。
- 做：错误 / 提示元素加唯一 id（`useId()`），控件加 `aria-describedby`；错误存在时优先指向错误。DESIGN.md §5.2 补一句。

### B2 对话框描述

- 现状：`ConfirmDialog.vue:28` 不传 `description`，reka 生成的 `aria-describedby` 指向不存在的节点（控制台「Missing Description」警告），确认框的后果文字不会被朗读；`layout/AppShell.vue:230-236` 「更多」抽屉同样；`AccountSecurityPanel.vue` 的两个弹窗同样。
- 做：`ConfirmDialog` 把 `message` 作为 Dialog 的 `description`（或 Dialog 增加 `#description` 插槽，正文里 `DialogDescription` 包住 message）；「更多」抽屉加 sr-only 的 `DialogDescription`；两个账号弹窗传 `description`。
- 验收：浏览器控制台不再出现 reka 的 Description 警告。

### B3 手写浮层

- 现状：`components/ai/AiPanel.vue:125-162` 是手写的 `role="dialog" aria-modal`，没有焦点圈定，关闭后焦点不回到顶栏触发按钮，Tab 能跑到背后页面；未配置时也没有可聚焦元素。`BackupManagerPanel.vue:139-148` 恢复中的遮罩没有 role 与文字，也不阻止键盘触发「立即备份」。
- 做：AiPanel 改用 reka `DialogRoot / DialogPortal / DialogOverlay / DialogContent`（与「更多」抽屉同款），保留 `aria-label="AI 助手"`、关闭按钮名「关闭」、textarea 的 Enter 发送 / Shift+Enter 换行、打开后聚焦输入框；`AiPanel.spec.ts` 相应调整挂载方式。恢复中遮罩改为 `Dialog persistent`（标题「正在恢复备份」+ `role="status"` 文字）。

### B4 异步状态的 live region

- 现状：`components/import/ImportStatusBar.vue:57-61` 「保存中… / 草稿已保存」、`:42,:49` 识别与 AI 状态，`ImportUploadSection.vue:44-46` 上传中，`WorkflowAttachments.vue:61` 上传中，`DocumentCollection.vue:27` 的 `refreshing` 都没有读屏可感知的文字。`RequestCollection.vue:74` 的 `role="status"` 是现成写法。
- 做：各处加一个 sr-only `role="status"`，只在状态变化时更新文字（轮询不要每 1.5 秒重复播报同一句）。

### B5 触控目标

- 现状：`Pagination.vue:49` 页码按钮 `h-7 min-w-7` 在触屏不增高；`Select.vue:85`、`SearchInput.vue:74` 清空按钮 `size-6`；`PurchaseRegisterDialog.vue:163` 历史价药丸 `h-6`；`SettingsLayout.vue:139` 手机药丸导航 `h-8`。
- 做：`pointer: coarse` 下分别到 40px（清空按钮可用负外边距扩大点击区而不改视觉）；DESIGN.md §4 补充。

### B6 导入明细的可访问名称

- 现状：`components/import/ImportDraftEditor.vue:94` 品名输入没有 `label`，名称退化成占位文字；`:100,:107,:116` 规格 / 数量 / 单位每行同名，`:138-144` 每行的「删除」同名。
- 做：带行号的 label（「第 N 行品名 / 规格 / 数量 / 单位」，`hide-label`）与「删除第 N 行」。**先 grep `e2e/import.spec.ts`** 里 `getByLabel / getByRole` 用到的名称；若 e2e 用精确匹配旧名，改测试并记录。

### B7 表格语义与手机密度

- 做：所有 `table-base` 的 `th` 加 `scope="col"`；`components/workflow/RequestProgress.vue` 在 `< 640px` 的卡片里隐藏数值为 0 的次要列（申请、待处理、尚待办理与进度条始终显示），避免一条「待采购 20 个」显示 7 行「0 个」；DESIGN.md §8 申请详情处补一句。e2e 按 `tr[data-request-line]` 与 `data-label` 找格子，隐藏用 CSS 而不是不渲染。

### B8 页面标题

- 现状：`router/index.ts` 的 `meta.title` 从未写进 `document.title`，所有标签页都叫「仓廪 · 采购与领用」。
- 做：`router.afterEach` 设置「{meta.title} · 仓廪」；申请详情在数据到位后改成「{流水号} · 仓廪」；登录页「登录 · 仓廪」。

### B9 错误边界

- 现状：没有 `onErrorCaptured`，组件渲染异常只会弹一条 toast，页面空白。
- 做：`AppShell.vue` 的 `<router-view>` 外包一层边界组件：捕获后显示 `ErrorState`「页面出现异常」+「重新加载」（`location.reload()`），`console.error` 保留；路由变化时重置。`main.ts` 的全局兜底不动。

## 4. 批次 C：工程一致性

### C1 Idempotency-Key 包装统一

- 现状：`api/workflow.ts:18`、`:56`（metadata 的 PATCH 副本）、`api/index.ts:95` 三份相同逻辑。
- 做：`api/client.ts` 导出 `mutate<T>(method, url, body)`，三处改用；行为不变（key 存 sessionStorage，成功后才清）。

### C2 加载 / 错误样板收敛

- 现状：`useWorkflowResource` 放在 `components/workflow/` 但是通用的；`ImportPendingAside.vue:21-41`、`ImportTaskList.vue:20-43`、`SuppliersView.vue:35-59`（供应商加载还没有竞态守卫）、`SettingsView.vue:35-70`、`AuditView.vue:22-31`、`WorkflowReportsView.vue:30-32` 各自手写。
- 做：移到 `src/composables/useResource.ts`（原路径 re-export 以免大改引用），能改的页面改用；语义不同（如报表的「查询」语义）就跳过并记录。

### C3 金额与单价格式

- 现状：`PurchaseRegisterDialog.vue:98-102` 重写了 `presentation.ts:11` 的 `moneyLabel`；「¥单价 / 单位」在 `DocumentCard.vue:58`、`PurchaseRegisterDialog.vue:226`、`StockProductCard.vue:50,144`、`SuppliersView.vue:174` 内联且没有千分位；`utils/format.ts` 的货币函数没有任何调用方。
- 做：`presentation.ts` 增加 `unitPriceLabel(price, unit)`，五处改用；`format.ts` 无人用的函数删除，或让 `presentation.ts` 调用它，二选一，不留两套。

### C4 导入任务状态集中

- 现状：`PENDING || RUNNING` 判断在 `ImportTaskList.vue:51,60`、`ImportPendingAside.vue:43`、`ImportRecognitionSteps.vue:20`、`useImportTask.ts:62,240` 六处；状态标签在 `ImportPendingAside.vue:45-49` 与 `ImportTaskList.vue:50-56` 各一份；相对时间 `workbench.ts:50`（「今天 14:05」）与 `ImportTaskList.vue:78`（「14:05」）输出不同。
- 做：新建 `components/import/status.ts`（`isTaskActive`、状态文案与图标映射）；相对时间统一用 DESIGN.md §8 写的规则（今天只写时刻、昨天「昨天 HH:mm」、完整时间在 `title`）。

### C5 登记行逻辑

- 现状：`selectedCount / rowErrors / selectAll` 在 `PurchaseRegisterDialog.vue:37-42,94-96`、`ReceiptRegisterDialog.vue:22-27,42-44`、`QuantityCommandDialog.vue:42-47,59-61` 三份。
- 做：抽成 `useRegisterLines`，三个弹窗共用；现有 spec 必须继续通过。

### C6 UI 基元 API（同步更新 DESIGN.md §5）

- `sm` 在 Button / NativeSelect 是 28px，在 Input / Select 是 32px；`md` 34 对 36；触屏只有 Button 增高，`RequestCreateDialog.vue:149` 为此打了局部补丁。做：Input / Select / NativeSelect / SearchInput 在 `pointer: coarse` 下 sm / md 增高到 40 / 44，去掉局部补丁；NativeSelect sm 手机上不用 `text-xs`；尺度差异在 DESIGN.md 写明（字段 32 / 36 是刻意的，还是统一到 28 / 34，二选一）。
- `Tabs`、`SearchInput` 增加 `disabled`；`QuantityCommandDialog.vue:114` 保存中禁用退货方式 Tabs。
- `ConfirmDialog` `loading` 时取消 / Esc / 遮罩都不可关（内部传 `persistent`）。
- `ErrorState` 的 `retrying` 改名 `loading`（调用方一起改）。
- `FileDropzone` 的拒绝提示按 `accept` 生成，不再写死「PDF / PNG / JPG / WEBP」。
- `Pagination` 支持 `v-model:page`；`Disclosure` 发 `update:open`。

### C7 列表上限

- 现状：`/workflow/stock`（`apps/server/src/workflow/workflow-query.service.ts:167`）与 `/workflow/prices` 全量返回，前端不分页；供应商列表没有搜索。
- 做（最小）：库存页与成交价格表前端「显示更多」（每批 50）并显示总数；供应商表加搜索框。服务端分页只在确有必要时加可选 `page / pageSize`，默认行为不变并补 server 测试。

### C8 零散规范违例

- `ImportStatusBar.vue:65`、`NotFoundView.vue:19` 用 button 做导航 → `router-link` + `buttonClass`。
- `RequestRow.vue:66` 操作格手写 `sm:py-2`（已含 `.row-action`）→ 删掉。
- `Switch.vue:68`、`ImportOriginalPreview.vue:49` 的 `bg-white`、`BackupManagerPanel.vue:141` 的 `dark:bg-black/60` → 令牌；遮罩类 `bg-ink/40 dark:bg-black/60` 五处抽成全局 `.overlay`。
- `AuditView.vue:204-208` 摘要按对象顺序拼接，操作编号 UUID 排在最前被截断 → 流水号 / 文件名 / 明细行数优先，操作编号放最后。
- `ImportRecognitionNotices.vue:32-62` 手写的琥珀块：给 `Notice` 加「列表 + 每项图标」的用法（或 `#items` 插槽），改用后删掉手写版。

## 5. 批次 D：装饰

### 评估结论

「墨线」的定位是颜色只给信息、层级靠字号与留白：DESIGN.md §1 明确不做大插画、渐变、彩色图标底，§9 不引网络字体与图标库，v2.1.0 时删掉了插画组件，登录页也特意不加纹理。所以**不建议**：照片、素材库插图、渐变 hero、背景纹理、第三方图标库、网络字体、彩色标题。

**建议**只做四处克制的「墨线画」：单色线描 SVG（`currentColor`、2px 描边、圆角线帽、≤ 120px、`aria-hidden`），只出现在没有数据的地方；再补齐品牌资产和两处微动效。整体仍是一套系统，深色下自动换色。

### D1 登录页

- 桌面 `≥ lg` 改成左右两栏：左侧 5/12 品牌面板（画布色）放朱砂方印 + 「仓廪」+ 一句定位 + 一幅线描插画（粮仓或账册母题，`text-line-strong` 描边、少量 `text-accent` 点缀）+ 三条价值点（原件先存档 / 按量采购可追溯 / 库存与领用同一本账）；右侧表单面板保持现状。手机仍是单栏，插画缩到 72px 放在表单上方或不显示。
- 保留 `input[type=password]`、按钮「登 录」、恢复码与初始化流程、页脚版本号（e2e 依赖）。

### D2 EmptyState 线描

- `EmptyState` 新增 `art` prop：`ledger`（申请单）、`box`（库存）、`archive`（备份）、`inbox`（导入任务）；线描 SVG 放 `components/ui/art.ts`（导出 path 字符串）或直接在 EmptyState.vue 里按名渲染；默认不画，传了才画；筛选无结果仍 `icon=false`。
- 用在：工作台「还没有申请单」、申请单首次使用、库存「还没有库存物品」、备份管理「还没有备份」、导入任务列表空态。
- DESIGN.md §5.9 改写：允许单色线描，禁止彩色插画与照片。

### D3 404 页与导入上传框

- `NotFoundView` 用同款线描（`search` 母题）。
- `FileDropzone` 在导入页的上传态（撑高到 280px 的那个）把 48px 图标块换成 96px 线描「单据 + 扫描线」；拖入时只变描边色；手机与页尾的紧凑上传框保持现状。

### D4 品牌资产

- 生成 `apps/web/public/apple-touch-icon.png`（180×180，方印铺满、朱砂底白图形、不留透明边），`index.html` 加 `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`。
- manifest 增加 `purpose: 'maskable'` 的 512 图标（图形占中心 60% 安全区），`vite.config.ts` 的 `manifest.icons` 补项。
- PNG 用已安装的 Playwright Chromium 渲染 SVG 得到（没有 rsvg / ImageMagick）：写 `apps/web/scripts/render-icons.mjs`，README「本地开发」补一句怎么重新生成。

### D5 微动效（都要尊重 `prefers-reduced-motion`，全局已缩短动画时长）

- 导入「已确认导入」的 teal 对勾描边动画（`stroke-dasharray / dashoffset`，300ms）。
- 登录面板首帧 `animate-pop-in`。
- **不要**加路由切换过渡：e2e 依赖即时渲染，`<main>` 的回顶逻辑也会受影响。

## 6. 批次 E：测试

### E1 视觉回归 `apps/web/e2e/visual.spec.ts`

- 复用 `playwright.config.ts` 的 webServer；用 API 播种一组固定数据（两家供应商、四张申请、采购 / 到货 / 入库 / 直发 / 库存领用各一笔、上传一张 1×1 PNG 得到一个导入任务，合成 OCR 会解析成一条「测试用品N」）。注意 `/api/auth/setup` 只初始化密码不发 Cookie，之后要再 `/api/auth/login`；写操作带 `Idempotency-Key`。
- 矩阵：1440×1000 与 390×844（`deviceScaleFactor: 2`）× 浅 / 深色（深色用 `addInitScript` 写 `localStorage.canglin-theme = 'dark'`）；页面：工作台、申请单、申请详情、库存四个页签、导入空态与任务页、报表、设置、供应商、审计、登录；弹窗：登记采购、直接发放、人工录入申请。
- `toHaveScreenshot` 基线放 `e2e/visual.spec.ts-snapshots/`，`maxDiffPixelRatio: 0.01`，截图前等 `.animate-pulse` 消失。字体差异会让本地与 CI 基线不一致：要么基线在 CI 生成（`--update-snapshots` 的工作流步骤），要么 CI 跳过此 spec 并在 README「测试」写明，二选一并记录。
- 播种与截图的参考脚本在 `/tmp/claude-0/-projects-canglin/6c2f1be6-a18e-4869-87a5-16c87c2f7ee7/scratchpad/shoot.mjs`（会话临时文件，可能已不在；不在就按本节描述重写）。

### E2 单测（vitest + @vue/test-utils，照现有 spec 的写法）

- `useImportTask`：自动保存链合并与版本回写、保存失败时 `guardUnsaved` 拦截切换、轮询在非活动状态停止、切换任务清空全部状态、404 任务置 `missing` 且不再轮询、确认成功后 `finished`。
- `Dialog`：dirty 时关闭先二次确认、persistent 不可关、Esc 先关内层确认。
- `RegisterLineTable` / `useRegisterLines`：全选、半选、行级错误。
- `useUrlState`：URL → 状态只一次、状态 → URL 用 replace、默认值不写 URL、保留其它 query。
- `stores/auth`：`refresh` 不可达时降级不抛错。
- `SettingsLayout`：带 hash 打开定位到区块、滚动时当前项变化。

### E3 e2e `apps/web/e2e/settings.spec.ts`

- 改密后旧会话失效需重登；创建 / 下载 / 删除备份；供应商新增、编辑、有单据时不可删；审计日志按类型筛选与搜索。复用 `workflow.spec.ts` 的 `login` 写法。

## 7. 截图与播种环境

- 隔离 API：`node apps/server/test/browser-server.cjs`（端口 3301，每次启动一个新的临时 SQLite；需要先 `pnpm --filter @canglin/server build`）。前端：`API_PROXY_TARGET=http://127.0.0.1:3301 pnpm --filter @canglin/web exec vite --host 127.0.0.1 --port 5174 --strictPort`。
- 无头 Chromium 需要中文字体：本机已装 `fonts-wqy-microhei`（`fc-list :lang=zh` 应 ≥ 1）；没有就 `apt-get install -y fonts-wqy-microhei && fc-cache -f`。
- 用 `--lang=zh-CN` 启动 Chromium 后原生 `type="date"` 仍显示 `mm/dd/yyyy`，这是环境问题，不是应用缺陷。
- 结束时按端口找 pid 再 `kill`；不要 `pkill -f browser-server`（会连自己的 shell 一起杀）。

## 8. 实施记录（执行者填写）

每批一段，格式：

```
### 批次 X（日期）
- 完成：A1、A2 …（一句话说明改了什么、改了哪些文件）
- 跳过：A6 — 原因
- 与方案不同：…
- 改动的测试接口（文案 / aria / 按钮名）：…
- 校验：typecheck ✓ lint ✓ test N passed（原 213）/ e2e M passed / 截图检查了哪些页面
```

### 批次 A（2026-10-14）

- 完成：
  - A1 设置页：`SettingsView` 首屏四个请求 `Promise.allSettled` 并行；系统状态「刷新」改为只重拉系统状态与 OCR 健康（`refreshStatus`，`SystemStatusPanel` 新增 `refreshing` → 按钮 `loading`），不再换掉交给面板的 `autoBackup` / `aiConfig`，填到一半的 AI 地址、备份间隔不被覆盖；备份列表失败经 `BackupManagerPanel` 的 `v-model:error` 显示 inline 红字 +「重试」（面板自己的 `reloadList`），AI 配置失败时 `AiSettingsPanel`（新 props `loadError` / `retrying`、事件 `retry`）只显示错误与「重试」，不再给空表单。
  - A2 `WorkflowAttachments`：垃圾桶打开 `ConfirmDialog`（danger，写文件名与「删除后不能恢复」），确认后才删；`BackupManagerPanel` 删除确认框传 `:loading`，`deleting` 在途时忽略重复点击；创建 / 删除成功后的列表重拉失败只记在区块里，不再报成操作失败。
  - A3 `ReceiptRegisterDialog`、`QuantityCommandDialog`、`PurchaseRegisterDialog` 的 `save()` 开头清 `failure`；`PurchaseRegisterDialog` 的供应商加载改为独立的 `supplierError` + `loadSuppliers()`（只认最后一次请求），错误贴在「本次供应商」下方并带「重试」，成功即消失。
  - A4 导入页：a) `useImportTask` 新增 `confirmBlockers`（用 `workflowImportConfirmSchema.safeParse` 归纳单据头 / 品名 / 数量 / 单位，加上逐页核对、AI 建议待核对、原件缺失；AI 判断抽成 `aiPending`，与服务端同口径且只会更宽松），`ImportView` 在 `#start` 显示「还不能导入：…」并禁用确认按钮（`aria-describedby` 指向它，不是 alert）；b) `reloadDraft` 只打开 `reloadOpen`，`ImportView` 渲染「重新载入已保存版本？」确认框，`confirmReloadDraft` 执行原逻辑；c) `ImportHistoryPanel` 重写：展开才加载、按草稿版本去重（`historyVersion`）、骨架 / inline 错误 + 重试 / 一行空态，调用状态中文映射（含服务端还会写的 `UNKNOWN`「结果未知」），费用 `¥x.xxxx`、未发送「不计费」、无数据「—」；d) 放弃草稿的失败写 `discardError`，只在确认框里显示。
  - A5 `SuppliersView`：有单据的供应商删除确认框 `confirmDisabled` +「已有 N 份单据，不能删除…」；成交价格再次查询保留旧表格，工具栏「查询中…」（`pricesLoaded`）。`AccountSecurityPanel`：重置恢复码的空密码 / 密码错误改为字段 `error`（输入即清除），生成中禁用取消与输入、弹窗 `persistent`。`RecentDocumentsAside`：已有内容时刷新失败在底部显示 inline 错误 +「重试」。
  - A6 会话过期原地重登：`api/client.ts` 新增 `onSessionExpired(handler)`，401 时（前端仍登录、不在登录页、请求可重放）共用一个重新登录 Promise，成功后把原请求重放一次（`_replayed` 标记防循环）；新组件 `components/layout/SessionExpiredDialog.vue`（`Dialog compact persistent` + 密码框，「重新登录」/「去登录页」），由 `AppShell` 注册、卸载前把等待中的请求按放弃处理。
- 跳过：无。
- 与方案不同：
  - A5 实测发现重置恢复码、修改密码输错当前密码时服务端返回 401，原拦截器把它当成会话过期，直接清登录态并跳登录页（方案以为只是 toast）。前端在 `client.ts` 增加 `isCredentialCheck`：`/auth/login|setup|recover|change-password|recovery-code` 的 401 不再触发跳转，交给页面显示；服务端未改。
  - A6 上传类（`FormData`）请求与 `/auth/*` 不重放，保持原来的跳转登录页（方案允许）；重放沿用原请求的 `Idempotency-Key`，第一次 401 由守卫拒绝、未执行业务，重放不会重复入账（浏览器实测：采购登记只记一次）。
  - A1 刷新失败用 toast「系统状态刷新失败：…」（保留旧数据）；方案未规定刷新失败的展示。
- 改动的测试接口：无（未改 e2e / spec 依赖的文案与名称）。新增可见文案与名称：「重试」（备份、AI 配置、历史、最近登记、供应商清单）、「删除附件」确认框、「重新载入已保存版本？」确认框（按钮「重新载入」）、「会话已过期，请重新登录」弹窗（「重新登录」「去登录页」）、`#import-confirm-blockers`。
- 浏览器实测（隔离 API + vite，Playwright 脚本）：A6 401 弹框、错密码留在框内、重登后重放成功且只登记一次（4/4）；A5 空密码 / 错密码字段错误且留在设置页；A1 刷新后 AI 地址仍在、备份与 AI 配置失败显示错误并能重试；A2 备份删除连点只发 1 个 DELETE、附件删除在「付款与发票」弹窗里嵌套确认正常；A4 阻塞项与禁用、历史开合只请求一次、重新载入确认、放弃失败只显示一次。
- 校验：typecheck ✓ lint ✓ test 213 passed（36 个文件，原 213）
