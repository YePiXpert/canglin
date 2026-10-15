# 约束整改方案（2026-10）

## 0. 背景与结论

2026-10-15 对全项目的约束做了一次复核：README「开发约定 / 安全模型」、`apps/web/DESIGN.md` 全文、`docs/rebuild-requirements.md`、`docs/upgrade-2026-09.md`、UI 方案 §1 / §5、两份 eslint 配置、`apps/server/src/config.ts`、compose、CI 与部署脚本。多数约束合理（单管理员、不引字体 / 图标库、颜色只用令牌、业务规则不可削弱、OCR 禁止运行时下载模型、30 分钟会话）。要改的是下面六项，按依赖关系排成 R1 → R4 → R5 → R3 → R6 → R2：

| 编号 | 内容 | 性质 |
| --- | --- | --- |
| R1 | 测试不再反向约束产品：e2e 改用稳定定位，删掉产品代码里「因为 e2e 所以不能…」的限制 | 必做，先做（后面几项改 UI 时才不会撞上脆弱的定位） |
| R4 | AI 模型白名单从共享契约移到运维配置 | 必做 |
| R5 | 部署护栏：拉不到镜像不再回退本地构建；可选的 pre-push 检查 | 必做 |
| R3 | 版心 1280 → 1536，申请详情的进度表在 1440 笔记本上不再横向滚动 | 必做 |
| R6 | 插画与素材：墨线插画（填充、一处朱砂、场景图），加到登录、完成态、「都办完了」、空态、404 与页面异常、AI 欢迎 | 做 |
| R2 | 视觉回归进 CI：固定容器与字体，重建基线 | 必做，最后做（R3 / R6 改完再重建基线） |

执行方式：按上面的顺序，每项结束跑 §1 的校验；**不 commit、不 push**，改动留在工作树；每项把结果写进文末 §8「实施记录」。上下文或时间不够时在项目边界停下，保证停下时校验全绿并记录到哪一步。

## 1. 执行规则（必须遵守）

- 设计与写法以 [apps/web/DESIGN.md](../apps/web/DESIGN.md) 为准；本方案要求改 DESIGN.md 的地方在同一项里改完。用户可见行为变了，在 CHANGELOG「未发布」下加一条。
- 不新增运行时依赖。前端只改 `apps/web`；服务端只改 R4、R5 点名的文件；不碰业务规则（撤销回冲、幂等、草稿版本号、原件关联）；不读生产配置与密钥。
- 改任何可见文案 / 可访问名称 / 定位钩子前先 `grep -rn` `apps/web/e2e` 与 `apps/web/src/**/*.spec.ts`；**改了就同步改测试**，并在实施记录里写明。这是 R1 之后的新规则，取代原来的「不改」。
- 每项先核对「现状」是否仍成立（行号是 2026-10-15 的，可能漂移）；不成立就跳过并记录原因，不要为了完成清单硬改。
- 每项的校验：

```bash
pnpm --filter @canglin/shared build      # 只在改了 packages/shared 时
pnpm typecheck && pnpm lint && pnpm test
```

- 涉及 e2e 的项（R1、R3、R4、R6）另加：

```bash
pnpm --filter @canglin/server build       # e2e 的 API 从 dist 启动
pnpm --filter @canglin/web test:e2e
```

  本机没有 Playwright 自带的浏览器时，先 `pnpm --filter @canglin/web exec playwright install chromium`（约 200 MB），或用一份临时配置覆盖 `use.launchOptions.executablePath` 指到系统 `/usr/bin/chromium`。
- 涉及部署脚本的项（R5）：`bash -n deploy/*.sh && python3 -m unittest discover -s deploy/tests -v`。
- 截图检查按 DESIGN.md §9，环境与播种方法见 [docs/ui-improvement-2026-10.md](ui-improvement-2026-10.md) §7。

## 2. R1 测试不再反向约束产品

### 现状

原则本身没错：可访问名称与文案是公开契约（DESIGN §7 末条、§9 第 3 条）。问题是定位器脆弱，产品代码反过来围着它转——`grep -rn e2e apps/web/src` 有 23 处注释在解释「因为测试所以不能…」。其中真正限制产品的：

| e2e 定位 | 被钉住的产品决定 |
| --- | --- |
| `e2e/import.spec.ts:248` `locator('section', { has: heading '未完成的导入' })` | `ImportView.vue:167` 上传区与任务面板外层不能再套 `<section>` |
| `e2e/import.spec.ts:392-393` `getByTitle(文件名)` 全页计数 2 / 1 | `ImportTaskList.vue:82`「每行只有文件名带 title」；状态条也只能有一处 title |
| `e2e/import.spec.ts:490` `rows.getByRole('link')` 按行数计数 | `ImportTaskList.vue:82`「每行只有一个链接」 |
| `e2e/import.spec.ts:177/307/326/424/514` `getByText('草稿已保存', { exact })`；`:160/169` `getByText('AI：已完成')` | `ImportStatusBar.vue:17` 读屏播报的措辞必须和可见文字不同 |
| `e2e/import.spec.ts:458` `locator('main .animate-pulse')` 为 0 | `Skeleton.vue:5` 不能去掉 `animate-pulse` |
| `e2e/reports.spec.ts:23` `locator('section').filter({ has: heading '采购金额' })` | 报表面板必须是 `section`，标题必须是这四个字 |
| `e2e/import.spec.ts:225` `card.locator('header').getByText('8 盒')` | `StockProductCard.vue:15` header 里的数量必须是一整段文字 |
| DESIGN §2 `animate-check-draw` 行 | 「不做路由切换过渡（e2e 依赖即时渲染）」 |

另有一些决定是对的、只是理由写成了 e2e：状态 chip 放在 `h1` 外（`workflow.spec.ts:33`）、Checkbox 说明不进名称（`Checkbox.vue:39`）、ErrorState 不带 role（`ErrorState.vue:8`）、Tabs 计数并入名称（`Tabs.vue:19`）、一页一个 `role="alert"`。这些是可访问性决定，e2e 只是顺带受益，保留但改理由。

### 改法

1. **定位约定**（写进 DESIGN §7 / §9，替换现在的措辞）：
   - 优先 `getByRole(role, { name })`、`getByLabel`；可见文案与可访问名称仍是契约，**改了就同步改测试**，不是「不改」。
   - 结构定位用业务钩子 `data-*`（已有 `data-request-id`、`data-document-id`、`data-product-id`、`data-request-line`、`data-command-line`、`data-receipt-line`、`data-purchase-line`）或 `data-testid`；不按 DOM 层级（`section` / `header` 祖先）、元素数量（title / 链接计数）或 CSS 类（`animate-pulse`）定位。
   - 读屏播报（sr-only `role="status"`）的措辞按读屏的需要写；测试把可见文字的定位 scope 到容器或 `data-testid` 里，不靠措辞差异避重。
   - 一页同时只有一个 `role="alert"`：保留，理由是可访问性。

2. **产品侧**：
   - `components/ui/Panel.vue`：有 `title` 时给 `<section>` 加 `aria-labelledby` 指向 `h2`（`useId()`），面板成为有名字的 region（读屏能按「未完成的导入」「采购金额」跳转）；没有 title 的 Panel 不加。DESIGN §5.5 补一句。
   - `components/import/ImportTaskList.vue`：`<li>` 加 `data-task-id`；删掉「只有一个链接 / 只有文件名带 title」的注释与限制。
   - `components/import/ImportStatusBar.vue`：可见的文件名、「识别 / AI」状态行、「草稿已保存」chip 各加 `data-testid`（`import-status-filename`、`import-recognition-state`、`import-save-state`）；sr-only 的措辞从「必须不同」改为「按读屏需要」（现状可以不动，但注释改写）。
   - `components/ui/Skeleton.vue`：加 `data-skeleton` 属性；注释改成「`data-skeleton` 是测试判断『已离开骨架屏』的钩子；`animate-pulse` 只是样式」。
   - 逐条改注释：`ImportView.vue:167`、`StockProductCard.vue:15`、`RequestProgress.vue:10/15`、`DocumentCard.vue:15`、`AppShell.vue:48`、`WorkflowReportsView.vue:180/207`、`AiSettingsPanel.vue:192`、`RequestCreateDialog.vue:16`、`RegisterLineTable.vue:10/12`、`Tabs.vue:19`、`Checkbox.vue:39`、`ErrorState.vue:8`、`ImportUploadSection.vue:27`、`FileDropzone.vue:11`、`ImportTaskList.vue:61/80/95`——保留的决定写可访问性理由（名称、region、单一 alert），删掉「e2e 所以不能」的句子；只剩「这是测试钩子」的说明。
   - DESIGN：§2 `animate-check-draw` 行删掉 e2e 理由（路由过渡仍不做，理由见第 4 点）；§5.4、§5.9（Skeleton）、§7 末两条、§8 各处「e2e 依赖 / e2e 按 … 找」改写为「测试接口（§7 定位约定）」或删除；§9 第 3 条改为「改用户可见文案、`aria-*`、按钮名或测试钩子时同步改测试，并在提交说明里写清」。

3. **测试侧**（只改定位，不改断言意图）：
   - `import.spec.ts` 的 `importPanel()` / `panel()`、`reports.spec.ts:23` → `page.getByRole('region', { name: '未完成的导入' | '采购金额', exact: true })`。
   - 文件名计数（`:392-393`）→ 状态条 `getByTestId('import-status-filename')` `toHaveText(B)`；列表 `rows.filter({ hasText: B })` 1 条、`filter({ hasText: A })` 1 条。
   - 链接计数（`:490`）→ `rows.evaluateAll((li) => li.map((el) => el.dataset.taskId))`，按 `data-task-id` 取任务 id。
   - `getByText('草稿已保存')` → `getByTestId('import-save-state')` `toHaveText('草稿已保存')`；`AI：已完成` / `AI：部分失败` → `getByTestId('import-recognition-state')` `toContainText(…)`。
   - `.animate-pulse`（`:458`）→ `page.locator('[data-skeleton]')` 为 0。
   - `card.locator('header').getByText('8 盒')`（`:225`）→ 数量元素加 `data-testid="product-quantity"`，测试 `card.getByTestId('product-quantity')` `toHaveText('8 盒')`。
   - 其余保持。

4. **路由切换过渡**：不加，理由改成产品理由写进 DESIGN §2：这是数据录入工具，切页靠即时渲染和 `<main>` 回顶；过渡会让回顶与 sticky 元素的时序变复杂。R6 的「情绪价值」只放在局部元素上。

### 验收

- `grep -rn "e2e" apps/web/src --include=*.vue --include=*.ts | grep -v "\.spec\."` 只剩说明钩子用途的注释，没有「所以不能 / 别去掉」。
- e2e 全绿（20 passed）；前端单测全绿；DESIGN §5.5 / §7 / §9 已改。

## 3. R2 视觉回归进 CI

### 现状

`apps/web/e2e/visual.spec.ts`（68 张基线，6.1 MB）只在 `VISUAL=1` 时运行，CI 跳过，必须单独跑在全新库上，基线依赖本机字体（文泉驿微米黑）与 Playwright 自带的 Chromium；本机的浏览器缓存又没了。结果是没有任何流程在比对。Playwright 1.64.0（`apps/web/package.json`）；本机有 Docker。

### 改法

1. **独立 project**：`playwright.config.ts` 加 `projects`：`functional`（`testIgnore: /visual\.spec\.ts/`）与 `visual`（`testMatch: /visual\.spec\.ts/`）；`test:e2e` 改为 `playwright test --project=functional`，新增 `test:visual` = `playwright test --project=visual`。两次调用各自启动 webServer（`browser-server.cjs` 每次 `mkdtemp` 新库），「全新数据库」自然满足；删掉 `VISUAL` 环境变量与 `test.skip(!RUN)`，`test.skip(!seed)` 的保险留着。
2. **固定渲染环境**：新建 `apps/web/scripts/visual.sh`——在 `mcr.microsoft.com/playwright:v1.64.0-noble` 容器里 `apt-get install -y fonts-wqy-microhei`，挂载仓库，`corepack enable && pnpm install --frozen-lockfile`（pnpm store 用命名卷缓存），然后 `pnpm --filter @canglin/shared build && pnpm --filter @canglin/server build && pnpm --filter @canglin/web test:visual`；`--update` 透传 `--update-snapshots`。基线只在这个容器里生成和比较（执行时核对镜像 tag 存在）。
3. **CI**：`ci.yml` 新增 job `visual`，`container: mcr.microsoft.com/playwright:v1.64.0-noble`，步骤与脚本一致（装同一个字体包 → install → build → `test:visual`），失败时 `actions/upload-artifact` 上传 `apps/web/test-results`（含 diff 图）；加进 `docker` job 的 `needs`——视觉变了没更新基线就不出镜像，和其它测试同等地位。
4. **重建基线**：R3、R6 做完后 `visual.sh --update` 一次，替换 68 张（文件名后缀 `-linux` 不变），人工看一遍差异；旧基线删除。
5. **文档**：README「测试」与 DESIGN §9 的视觉回归段改为「用 `apps/web/scripts/visual.sh`，有意改 UI 后 `--update` 并人工查看差异」，删掉「依赖本机字体 / `VISUAL=1` / 必须单独运行」的说明；`visual.spec.ts` 文件头注释同步。

### 验收

- 本机 `visual.sh` 连续两次 68 张全部一致；CI `visual` job 绿；`test:e2e` 不再含视觉用例（20 passed、0 skipped）。

## 4. R3 版心放宽

### 现状

`components/layout/AppShell.vue:126` `--main-px: max(2rem, (100vw − 1280px) / 2)`，所有页面版心 1280。~~申请详情 `RequestDetailView.vue:112` 右栏固定 360px，左栏 1280 − 360 − 28 = 892px，而进度表 `RequestProgress.vue:37` `min-w-[940px]`——在 1440 笔记本上就横向滚动~~（执行时更正：进度表在页面全宽、不在两栏里，1280 版心放得下 940px，原来就不滚动；两栏的是下面的「业务记录 | 原件与附件」）。库存行列表 `StockView.vue:124` `sm:min-w-[58rem]`（928px）。放宽的实际收益是宽屏（≥ 1600px）两侧少留白，导入页 5 : 7 两栏的原件预览与明细更宽，长品名与规格少截断。

### 改法

- 全局上限 1280 → 1536（Tailwind `2xl`）：`AppShell.vue:126` 改成 `lg:[--main-px:max(2rem,calc((100vw_-_1536px)/2))]`，注释（`:120`、`:204`）与 DESIGN §3 的变量表同步。不按页面区分：顶栏与内容共用这个变量，按页面变会让导航在切页时左右跳。
- 结果：1440 视口下内容 1376px（原 1280），1920 下 1536px（原 1280）；导入页原件预览在 1920 下约 630px（原 523px）。
- 不动：设置页右侧 760px（`SettingsLayout`）、登录页、各表的 `min-w-[…]`、`RequestProgress` 的 `@container` 断点。
- 核对：工作台三栏 `200 / 1fr / 180` 中栏变宽后 `WorkbenchRequestRow` 的行内布局；导入页 5 : 7 两栏草稿表在 ≥ 36rem 维持表格；`ImportDraftEditor.vue:64` 注释里的「1280 以下」改写；KPI 行与报表核心指标在 1536 下的留白。
- 截图：1440 × 浅 / 深色的工作台、申请详情、库存、导入任务页、报表；再用 1920 宽看申请详情与库存。视觉基线由 R2 重建。

### 验收

- 1440 下申请详情进度表容器 `scrollWidth === clientWidth`；390 不变；DESIGN §3 已改。

## 5. R4 模型白名单改为运维配置

### 现状

`packages/shared/src/schemas.ts:151-165` 写死 `AI_MODELS` 三项与 `refine` 的错误文案；`apps/server/src/ai/ai.controller.ts:61` 用它过滤服务商返回的列表；`ai-config.service.ts:60/128` 两处把 `gpt-6.1-sol` 固定为 `reasoningEffort: 'medium'`；`AiSettingsPanel.vue:75/77/103/314` 用它生成选项、锁定推理强度、写「所选的三个模型」；README:45、`docs/upgrade-2026-09.md:30`、`.env.example:19`。测试：`apps/server/test/ai.spec.ts:31/116`、`AiSettingsPanel.spec.ts:29`、`e2e/import.spec.ts:45`（option 恰好 3 个）。换一个模型名 = 改代码、发三个镜像。这是 2026-10-12 的决定（f17bad8），目的（防止选到不能识图 / 结构化输出的模型）保留，手段改成配置。

### 改法

1. **服务端配置**：`config.ts` 新增 `llmAllowedModels`：环境变量 `LLM_ALLOWED_MODELS`（逗号分隔；未设置 = 现在的三个；`*` = 不限制）。`docker-compose.yml`、`deploy/compose.trial.yml`、`.env.example` 加透传与示例。
2. **契约**：`aiConfigSchema.model` 退回普通字符串（`min(1).max(100)`），删掉 `refine`；`AI_MODELS` 改名 `DEFAULT_AI_MODELS`，只给服务端当默认值，前端不再引用。新增 `aiModelOptionSchema = { id, label, reasoningEffort? }`；`GET /api/ai/config` 响应增加 `models: AiModelOption[] | null`（`null` = 不限制）。
3. **服务端校验**：`AiConfigService.updateConfig` 在限制生效时拒绝不在列表里的 `model`（400「模型不在允许列表：…」）；`GET /api/ai/models` 返回服务商列表，限制生效时按列表过滤，不限制时原样返回。`gpt-6.1-sol` 固定中等思考改为按选项上的 `reasoningEffort`（默认列表里给它写 `medium`），`ai-config.service.ts` 两处不再硬编码模型名。
4. **前端**：`AiSettingsPanel` 从 `aiApi.config()` 取 `models`：有列表 → `Select`（label 用服务端给的）；`null` → `Input` + `suggestions`（候选来自「获取模型列表」）。推理强度锁定按所选选项的 `reasoningEffort` 判断。错误文案「服务商没有返回所选的三个模型」改为「服务商没有返回允许列表中的模型」，不限制时「服务商没有返回任何模型」。
5. **测试**：`ai.spec.ts` 新增「不在允许列表 → 400」「`LLM_ALLOWED_MODELS=*` 时任意模型通过、`/models` 返回服务商全部列表」；`AiSettingsPanel.spec.ts` 用 mock 的 `models`；`browser-server.cjs` 显式设 `LLM_ALLOWED_MODELS` 为三个（e2e `toHaveCount(3)` 不变）。
6. **文档**：README「AI 能力」那句改为「默认只提供 …，可用 `LLM_ALLOWED_MODELS` 调整或取消限制」；upgrade 文档「配置第三方 Responses」第 2 步同步；CHANGELOG。

### 验收

- 默认部署行为与现在完全一致（三个选项、GPT 中等思考、服务商列表按三个过滤）；改环境变量重启后设置页选项跟着变；服务端、前端、e2e 全绿。

## 6. R5 部署护栏

### 现状

`deploy/upgrade.sh:102-105`、`deploy/deploy.sh:68-81`：拉不到镜像就本地构建。CI 红的提交没有镜像（`ci.yml` 的 `docker` job `needs` 全部测试；`concurrency.cancel-in-progress` 还会取消被后续 push 顶掉的运行），这时升级会把没过测试的源码构建上线。`deploy/tests/test_paths.py:158` 还把这个回退当成期望行为。

### 改法

1. `upgrade.sh`：拉取失败 → `die`（此时还没停机），信息写明三种原因与出路：「该提交的镜像尚未发布——CI 还在跑或已失败（到 GitHub Actions 查看）；私有包需要 `docker login ghcr.io`；确认要用本地源码构建时加 `--build`」。`--build` 行为不变。
2. `deploy.sh`（首次部署）同样默认不回退；参数解析加 `--build`（现有位置参数「端口 目录」不变），README「首次部署」的命令示例同步。
3. `deploy/tests/test_paths.py`：`test_failed_pull_rebuilds_all_three_images` 改为 `test_failed_pull_fails_before_stopping`（返回码非 0、没有 `compose down` / `compose build`、stderr 含提示）；新增 `test_build_flag_builds_all_three_images`；deploy.sh 加对应用例。`deploy-scripts.yml` 会自动跑这些测试。
4. **可选、默认不启用**：`scripts/githooks/pre-push`——`pnpm --filter @canglin/shared build && pnpm typecheck && pnpm lint && pnpm test`；启用方式 `git config core.hooksPath scripts/githooks`，写进 README「开发约定」。不装 husky 之类依赖。
5. README「首次部署 / 版本升级」与 `docs/upgrade-2026-09.md` 的升级段落更新措辞，删掉「拉取失败自动回退本地构建」。

### 验收

- `bash -n deploy/*.sh` 通过；`python3 -m unittest discover -s deploy/tests -v` 全绿；伪 docker 下 `FAIL_PULL=1` 时服务未停止、退出码非 0。

## 7. R6 插画与素材（情绪价值）

### 评估结论

2026-10-15 用户补充「可以加素材和插画」。在原来「墨线画」的基础上放宽为**墨线插画**：仍是自绘的内联 SVG（令牌色、深浅色自动换、零依赖、没有授权问题），但允许纸面与淡色填充、一处朱砂点色和更大的场景图，放在登录、完成 / 办结、首次使用的空态、404 与页面异常、AI 助手欢迎这些有情绪价值的位置。仍不做：照片与素材库插图（风格对不上、授权不清）、渐变、大面积彩色、第三方插画 / 图标库 / 网络字体；业务数据区域（表格、表单、明细）不加装饰；动效 ≤ 300ms 并遵守「减少动态效果」（`main.css:666` 的全局规则已覆盖，新动效用 `both` 停在终态）。

### 规格（`components/ui/art.ts` + `LineArt.vue`）

- 每幅定义：`viewBox`（默认 120 × 96，场景图自定）；`fills`（按色调分组的填充面，画在线条下面：`paper` = surface、`shade` = surface-2、`amber` / `teal` / `blue` = 对应 `-soft`）；`paths`（主线，currentColor，调用方给 `text-faint` 或 `text-muted`）；`detail`（line-strong 细线）；`accent`（朱砂，一幅至多一处，传 `accent` 才画）。描边 2px 不随尺寸缩放、圆角线帽、`aria-hidden`。
- 尺寸：空态小图 96–120px；场景图 160–360px。
- 每幅都要在浅 / 深色下截图核对：深色下填充跟着令牌变深，不出现白块；线条在两种底色上都看得清。

### 清单

| 位置 | 母题 | 说明 |
| --- | --- | --- |
| 登录左栏（≥ lg） | `granary-scene`（新，场景约 340px） | 粮仓（瓦顶、石基、拱门、门楣朱砂印）、两袋粮、一束稻穗、远山一线、日轮（amber 淡填充）；代替现在 120px 的 `granary` |
| 登录（手机） | `granary` | 表单面板顶部方印旁不加；在面板上方放 72px 小图，矮屏（高 < 700px）不显示 |
| 工作台「今天的待办都处理完了」 | `rest`（新，72px） | 合上的账册（封面一方朱砂印）、一杯热茶（三缕热气）、一枝小盆栽（teal 淡填充）；代替 28px 绿勾，文字与「查看已办结」不变 |
| 工作台页头 | 问候 | 说明前加「上午好 / 下午好 / 晚上好」，纯文字 |
| 导入确认成功 | 「入账」方印 | 40px 朱砂方印（−4°），`animate-stamp-in` 180ms 盖章；代替 teal 对勾，`animate-check-draw` 无人使用后删除 |
| 申请单 / 工作台首次使用 | `ledger` | 加纸面填充 |
| 库存首次使用 | `shelf`（新） | 货架上三只纸箱，一只贴标签；代替 `box` |
| 导入任务列表空态 | `inbox` | 加填充 |
| 导入上传框 | `scan` | 加纸面填充，扫描线 blue |
| 报表首次无数据 | `report`（新） | 纸上三根柱形与一条折线，终点一颗朱砂点；有区间的无结果仍是 `icon=false` |
| 供应商首次使用 | `shop`（新） | 带布篷的小铺面 |
| 备份首次使用 | `archive` | 加填充 |
| AI 助手欢迎（还没有对话） | `brush`（新） | 砚台、毛笔与一页账，放在建议问题上方 |
| 404 | `lost`（新，场景约 200px） | 一块双向路牌，地上一页走丢的单据；代替 `search` |
| 页面异常（`RouteErrorBoundary`） | `spill`（新，约 140px） | 打翻的墨水瓶与一摊墨；页面级改成居中排版（插画 + 标题 + 说明 +「重新加载」），文字不变 |
| 登录左栏纸纹（可选） | 素材 | 内联 SVG 噪点，2–3% 不透明度，只在左栏；截图里显脏就不做并记录 |

### 规则改写

- DESIGN §1 第 5 条改为：「颜色是信息：数据区域只有状态和警示上色。插画只用墨线插画（§5.9）：自绘线描，可带纸面 / 淡色填充与一处朱砂，用于登录、空态、完成与办结、404 与页面异常、AI 助手欢迎；不用照片、素材库插图、渐变和大面积彩色」。
- DESIGN §5.9「墨线画」段改为「墨线插画」：规格、母题清单、允许出现的位置、盖章动效；§2 令牌表加 `animate-stamp-in`、删 `animate-check-draw`；§8 登录 / 工作台 / 导入 / 报表 / 设置的描述同步。
- `art.ts` 文件头注释同步。

### 验收

- 截图 1440 / 390 × 浅 / 深色：登录、工作台（待办清空与有待办）、导入确认成功、各首次使用空态、报表无数据、AI 助手欢迎、404、页面异常；减少动态效果下盖章直接显示终态。
- e2e 全绿；新增 `LineArt.spec.ts`（fills 按色调分组渲染、accent 开关、viewBox 与尺寸换算）。

## 8. 实施记录（执行者填写）

每项一段：

```
### Rx（日期）
- 完成：…（一句话说明改了什么、改了哪些文件）
- 跳过：… — 原因
- 与方案不同：…
- 改动的测试接口（文案 / aria / 定位钩子）：…
- 校验：typecheck ✓ lint ✓ test N passed / e2e M passed / 截图检查了哪些页面
```

### R1（2026-10-15）

- 完成：`Panel` 有标题时经 `aria-labelledby` 以标题命名（读屏可跳转的 region），e2e 改按 `getByRole('region', { name })` 找「未完成的导入」「采购金额」；`Skeleton` 加 `data-skeleton`；导入任务行加 `data-task-id`；导入状态条的文件名、识别、AI、保存状态加 `data-testid`；库存物品的主数量加 `data-testid="product-quantity"`。产品代码里「因为 e2e 所以不能…」的注释（18 个文件）改写成可访问性理由或删除；DESIGN §2、§5.3–§5.6、§5.9、§7、§8、§9 同步，§7 新增「测试接口与定位约定」，§9 改为「改了就同步改测试」。
- 跳过：无。
- 与方案不同：读屏播报（`ImportStatusBar` 的 sr-only）措辞没改，只去掉了注释里的限制；路由切换过渡仍不做，理由改写成产品理由。
- 改动的测试接口：`e2e/import.spec.ts`（面板按 region；状态条文件名按 testid、列表按行数；任务 id 读 `data-task-id`；「草稿已保存」「AI：…」按 testid；骨架按 `[data-skeleton]`；库存数量按 `product-quantity`）、`e2e/reports.spec.ts`（region）、`e2e/workflow.spec.ts`（`product-quantity`）、`e2e/visual.spec.ts`（`[data-skeleton]`、保存状态 testid）；`Panel.spec.ts` 新增 1 例。
- 校验：typecheck ✓ lint ✓ test 254 passed（原 253）/ e2e 21 passed、4 skipped（视觉回归，用系统 Chromium 154 经临时配置运行）

### R4（2026-10-15）

- 完成：`packages/shared` 的 `AI_MODELS` 换成 `AiModelOption` + `DEFAULT_AI_MODELS` + `fixedReasoningEffort()`，`aiConfigSchema.model` 去掉写死的 `refine`，`AiConfigView` 增加 `models`（`null` = 不限制）；服务端 `config.llmAllowedModels` 读 `LLM_ALLOWED_MODELS`（逗号分隔，未设置为默认三个，`*` 不限制），`AiConfigService.updateConfig` 拒绝列表外的模型（400），`GET /api/ai/models` 有列表时过滤、不限制时原样返回，GPT 固定中等思考改为查 `fixedReasoningEffort`；设置页有列表时下拉、`null` 时输入框（候选来自「获取模型列表」），推理强度锁定按所选模型判断。`.env.example`、`docker-compose.yml`、README「AI 能力」、升级说明「配置第三方 Responses」第 2 步、CHANGELOG 同步。
- 跳过：`deploy/compose.trial.yml` 没加——试用 compose 只透传列出的变量，不列就是默认的三个。
- 与方案不同：允许列表的校验放在 `AiConfigService.updateConfig`（服务层），不在控制器的 zod 管道；`trusted-import.spec.ts` 里「换模型使能力检测失效」的用例原来换成 `other`，现在换成允许列表里的另一个模型。
- 改动的测试接口：无（e2e 的三个选项不变；`browser-server.cjs` 删掉 `LLM_ALLOWED_MODELS`，不受开发机环境影响）。新增服务端 1 例、前端 1 例，`AiPanel.spec.ts` 的配置补 `models: null`。
- 校验：shared build ✓ typecheck ✓ lint ✓ 服务端 192 passed（原 191）/ 前端 255 passed / e2e 21 passed、4 skipped

### R5（2026-10-15）

- 完成：`deploy/upgrade.sh` 拉不到镜像时在停机前报错退出（提示 CI、私有包登录、`--build` 三条出路），并撤回这次尝试：源码 `git reset --keep` 回升级前的提交、删掉这次的 `release-*` 记录与三个回退标签；`deploy/deploy.sh` 同样不再回退构建，新增 `--build`（位置不限，端口与目录仍按位置读，未知 `--xxx` 在动手前退出），拉取失败时区分「这个提交的镜像还没发布」与「包不可访问」；新增可选的 `scripts/githooks/pre-push`（默认不启用）。README「Docker 部署」「开发约定」、升级说明「备份、恢复与回退」、CHANGELOG 同步。
- 跳过：无。
- 与方案不同：拉取失败后撤回源码与回退点是方案外加的：原来拉取失败会接着本地构建，现在这条路是「CI 还在跑」时的常态，不撤回的话下次升级会把新提交记成「旧版本」，回退点里的 `old-compose.yml` 也会是新版的。
- 改动的测试接口：`deploy/tests/test_paths.py` 的 `test_failed_pull_rebuilds_all_three_images` 换成 `test_failed_pull_fails_before_stopping`；新增 `test_failed_pull_restores_previous_source`、`test_build_flag_builds_all_three_images` 与 deploy.sh 的 4 例；假 git 加 `MOVES_HEAD`（merge 之后 HEAD 换成新提交）。
- 校验：`bash -n` 四个脚本 ✓ `sh -n` pre-push ✓ 部署脚本 25 passed（原 19，含 `docker compose config` 解析试用配置的 1 例）

### R3（2026-10-15）

- 完成：`AppShell.vue` 的 `--main-px` 版心 1280 → 1536，注释与 DESIGN §3 同步。
- 跳过：`ImportDraftEditor.vue:64` 注释里的「1280 以下的双栏」指视口宽度，与版心无关，没改。
- 与方案不同：方案「现状」说申请详情的进度表在 1440 下横向滚动，执行时实测不成立（进度表在页面全宽；1440 下容器 1374px、1920 下 1534px，`scrollWidth === clientWidth`，原来 1280 时也放得下）。已在 §4 更正；保留放宽，理由改为宽屏少留白、导入页原件与明细更宽。
- 改动的测试接口：无。
- 校验：截图检查 1440 / 1920 的工作台、申请详情、库存、报表（浅色），没有溢出或错位；单测与 e2e 见 R6。

### R6（2026-10-15）

- 完成：`art.ts` 改成按绘制顺序的形状列表（主线 / 细线 / 朱砂 / 蓝线，`paper`·`shade`·`ink`·`amber`·`teal`·`blue`·`accent` 填充，虚线），`LineArt.vue` 按令牌类渲染、淡色先垫纸面、高度按视窗比例；去掉 `accent` 开关（一幅至多一处朱砂，单测检查）。母题 13 个：`ledger`、`shelf`（新，代替 `box`）、`inbox`、`scan`、`archive`、`report`（新）、`shop`（新）、`brush`（新）、`rest`（新）、`granary`、`granary-scene`（新，登录场景 320 × 200）、`lost`（新，代替 `search`）、`spill`（新）。位置：申请单 / 工作台 / 库存 / 备份 / 导入任务 / 报表 / 供应商的首次使用空态，导入上传框，工作台待办清空，AI 助手欢迎，404，页面异常（`RouteErrorBoundary` 改成居中排版，文字与「重新加载」不变），登录左栏场景 + 纸纹（`.paper-grain`，内联 SVG 噪点）+ 手机小粮仓。导入确认成功换成 40px 朱砂「入账」印（`animate-stamp-in`，删掉 `animate-check-draw`）；工作台页头日期后加问候（`greetingLabel`）。DESIGN §1 第 5 条、§2、§3、§5.6、§5.9、§8 同步，CHANGELOG 加了 R3 / R6 / R1 三条。
- 跳过：无。纸纹看过浅 / 深色截图后保留（颗粒很淡，不显脏）。
- 与方案不同：登录场景里的「两袋粮」画出来像钱袋，换成一座粮囤加一只小粮袋；`rest` 的视窗裁成 120 × 64、放大到 112px，`spill` 裁成 140 × 56、放大到 200px（原尺寸里留白太多，显小）；问候按 6 个时段（含「夜深了」「中午好」）。
- 改动的测试接口：`EmptyState.spec.ts` 用例名的措辞；新增 `LineArt.spec.ts`（3 例）、`workbench.spec.ts` 问候 1 例。可见文案没有改动（「已确认导入」「已创建 N 条」「今天的待办都处理完了」「页面出现异常」「重新加载」照旧）。
- 校验：typecheck ✓ lint ✓ test 259 passed；截图检查（系统 Chromium，隔离 API + 全新库）：登录 1440 / 390 × 浅 / 深、首次使用的工作台 / 申请单 / 库存 / 导入 / 报表 / 供应商 / 备份、AI 助手欢迎、404（1440 / 390）、页面异常（把报表页模块换成 setup 抛错的组件）、待办清空、导入确认成功；每幅插画另在预览页按 1× / 3× × 浅 / 深色核对过。

### R2（2026-10-15）

- 完成：`playwright.config.ts` 分成 `functional` 与 `visual` 两组，`test:e2e` 只跑功能流程，新增 `test:visual`；`visual.spec.ts` 去掉 `VISUAL` 开关（`test.skip(!seed)` 的保险保留）。新增 `apps/web/scripts/visual.sh`：按 `pnpm-lock.yaml` 的 `@playwright/test` 版本用 `mcr.microsoft.com/playwright:v<版本>-noble`，在其上构建本地镜像 `canglin-visual:<版本>`（加 `fonts-noto-cjk`），把仓库（git 文件清单，含未提交的改动）打包进容器安装、构建、比较，`--update` 时把变化了的基线拷回；差异图在 `apps/web/test-results/visual/`。CI 新增 `visual` job（同一个镜像，第一步装同一个字体包），`docker` job 的 `needs` 加上它。68 张基线按 R3 / R6 之后的页面在容器里重建（6.7 MB），文件名因为分组多了 `-visual`。README「测试」、DESIGN §9、`visual.spec.ts` 头注释、CHANGELOG 同步。
- 跳过：无。
- 与方案不同：方案写的是装 `fonts-wqy-microhei`；实际先用镜像自带的文泉驿正黑生成过一版，发现它没有粗体、容器里也不合成粗体，中文标题全是常规字重（字重改动在视觉回归里会看不出来），于是改装 `fonts-noto-cjk`（真正的粗体，字体栈里本来就列了 Noto Sans CJK SC）再重建。本地用派生镜像而不是每次 `apt-get`：快，也不依赖每次能连上 apt 源。
- 改动的测试接口：`e2e/visual.spec.ts` 的运行方式（不再看 `VISUAL`，由 `--project=visual` 选择）；基线文件全部重建。
- 校验：容器里 `--update` 生成 68 张后连续比较两次 4 passed（每次约 1 分钟，pnpm 缓存在 docker 卷 `canglin-visual-pnpm`）；宿主机 `--project=functional` 21 passed；`test --list` 显示 functional 21 例、visual 4 例。CI 上的 visual job 还没跑过（要推送后才会运行）。

### 收尾（2026-10-15）

- 全量：`pnpm --filter @canglin/shared build && pnpm typecheck && pnpm lint && pnpm test` ✓（前端 259、服务端 192），e2e functional 21 passed，视觉回归 4 passed（容器），部署脚本 25 passed，`scripts/tests` 通过。
- 没有提交；用户要提交时可以按项提交（每项结束时都拍了树对象）。

### 验收（2026-10-15）

- R1：`grep -rn e2e apps/web/src`（不含 spec）为 0 处；DESIGN 只剩 §7 定位约定与 §9 的命令；functional 组 21 passed、0 skipped。
- R2：容器里基线重建后连续比较两次 4 passed（68 张）；`test --list` functional 21 / visual 4；CI 的 visual job 要推送后才会第一次运行。
- R3：1440 下申请详情进度表 `scrollWidth === clientWidth`（1374），1920 下 1534；390 走卡片不受影响。
- R4：真实 dist 服务端 + vite 端到端——`LLM_ALLOWED_MODELS=*` 时 `config.models` 为 null、任意模型名可保存、设置页是输入框并能回填与保存；`'grok-4.7, house-model,'` 时去空格去尾逗号得到两项、已知模型沿用显示名、列表外模型 400「不在允许列表」、列表内可保存、设置页下拉只有这两项。已知行为：允许列表改了之后，库里存着的旧模型不在列表里时，保存任何 AI 设置（包括只是关闭）都会 400，要先选一个列表里的模型。
- R5：`bash -n` 四个脚本 ✓，部署脚本 25 passed；`sh scripts/githooks/pre-push` 直接运行一次通过（34 秒）。
- R6：减少动态效果下「入账」印在元素插入后两帧内停在终态（opacity 1、transform 单位矩阵、rotate −4°，动画时长被压到 0.01ms）；正常动效 180ms、`both`；手机登录 844 高显示小粮仓、660 高隐藏，页面不横向溢出；错误边界显示插画 + 文字 + 重新加载，切页后恢复；404 / 供应商空态 / AI 欢迎的插画都在。
- 另有一位没参与实现的审查代理独立审了 diff，结论见下。

### 验收后修正（2026-10-15）

独立审查（没参与实现的代理，只读 diff）：无阻塞；1 条应修、9 条可选。处理如下：

- 已修：
  1. R4 应修——允许列表收窄后库里的旧模型不在列表里时，连关闭 AI 都存不了：服务端改为只在 `enabled` 时校验列表（`ai-config.service.ts`）；设置页在模型框下提示「已保存的模型「X」不在服务器的允许列表里…」，启用状态下保存先被前端拦下（「请选择允许列表里的模型」）；升级说明写明这一行为。
  2. `LLM_ALLOWED_MODELS` 只有分隔符（如 `,`）解析成空列表：改为回退默认的三个；`parseAllowedModels` 导出并新增 `apps/server/test/config.spec.ts`。
  3. `upgrade.sh` 停机前的三种失败（compose 解析不符、`--build` 构建失败、拉取失败）统一走 `undo_attempt`：退回源码、删回退点与回退标签；reset 失败时的提示不再自相矛盾。新增 5 个测试（含 `--no-pull` 不 reset、没有容器、reset 失败、构建失败、项目名不符）。
  4. `deploy.sh` 结尾的常用命令改成 `docker compose up -d server`（`restart` 不会读新的 `.env`），升级说明同步。
  5. `visual.sh`：写回宿主机的基线与差异图 `chown` 成当前用户（非 root 用户第二次运行不会被 root 文件挡住）；派生镜像标签带 Dockerfile 哈希；容器 `--cpus 4 --memory 6g`；`npm install -g` 的错误不再吞掉；打包改成逐个核对文件存在的可移植写法。
  6. e2e：`getByTestId` 的文字断言前补回 `toBeVisible()`（import 9 处、workflow 5 处、visual 1 处）。
  7. `apps/server/test/setup.ts` 清掉 `LLM_ALLOWED_MODELS`；`ImportView.vue`「绿色对勾」与 `workbench.ts` 错位的 JSDoc 两处过期注释。
- 未改（可选）：运行时 `isReady` / `canImport` 对列表外的已保存模型仍放行——收窄列表不该让正在用的识别与问答静默停掉，设置页已有提示；CI 的 `visual` job 首次运行要等推送。
- 复验：服务端 194 passed（原 192）、前端 260 passed（原 259）、部署脚本 30 passed（原 25）、functional e2e 21 passed、容器视觉比对 4 passed（68 张基线未变）、R4 端到端 15 项通过（含收窄列表后的提示与切换）、减少动态效果等行为验收 5 项通过。
