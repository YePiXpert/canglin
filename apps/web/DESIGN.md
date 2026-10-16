# 仓廪 前端设计与维护规范 —「墨线」

## 2026-09-30 业务工作区

主导航（桌面顶栏）为工作台 `/workbench`、申请单 `/requests`、库存与领用 `/stock`、导入单据 `/import`、报表 `/insights`、设置 `/settings`。旧版台账、发放、库存与报表页面已删除，旧地址（`/legacy-workbench`、`/ledger`、`/distributions`、`/inventory`、`/reports`）由路由重定向到对应的新页面；业务页面位于 `src/views/workflow/`，通用动作、数量表单、附件和历史单据组件位于 `src/components/workflow/`。

申请详情 `/requests/:id` 集中显示原件、逐行数量进度、收货待处理与单据历史。数量从后端真实余额推导，不用单一状态掩盖部分采购/部分到货；直发余量保留待处理，入库须明确执行。规格与单位必须可见，禁止把不同单位数量合计成“件”。所有数量金额计算使用 shared 定点函数，展示保留接口十进制字符串。

导入页以 AI 原件识别为主、本地 OCR 为备用，先人工核对再生成申请。`components/import/` 维护导入页的各个区块：`useImportTask.ts` 持有页面全部状态与逻辑（`ImportView` 调用一次并 provide，子组件 inject 同一份状态直接读写，不经 props，唯一的自动保存 watch 因此看得到每一处编辑），`ImportStatusBar`、`ImportRecognitionNotices`、`ImportOriginalPreview`、`ImportDraftEditor`、`ImportHistoryPanel`、`ImportUploadSection` 对应页面各区块，`ImportRecognitionSteps`、`ImportTaskList` 是识别步骤与任务列表；`ImportView` 只做编排。不得把识别完成显示成业务入账完成，已确认任务要能返回对应申请。

## 0. 定位与使用方式

- 本文描述**当前**前端的设计语言、组件选用与约束，供之后改 UI 的人对照。2026-10 起换成「墨线」：令牌、外壳与 UI 基元（§1–§7）已经换新，各页面按 §8 逐页跟进；页面与本文冲突时以本文 §1–§7 为准。本文不是待办清单，也不记录施工过程。
- 具体取值以源码为准：颜色、圆角、阴影、字体、动效在 `src/styles/main.css`（`@theme` 与 `.dark`）；组件的 props / 事件 / 插槽在 `src/components/ui/*.vue`、`button.ts`、`tabs.ts`；外壳在 `src/components/layout/AppShell.vue`、`SettingsLayout.vue`。本文只写语义、选择和约束：颜色、阴影、动效的取值不抄（见 `main.css`）；文字层级、外壳尺寸与 `--main-*` 这几项结构尺寸为了便于对照列在 §2 / §3，改代码时要同步更新本文。
- 改 UI 时：先在 §5 找现成组件、§6 找通用写法，按 §3 / §4 核对外壳与手机规则，§8 看目标页面有没有特例，按 §9 验证。组件或令牌的行为变了，在同一次改动里更新本文。

## 1. 设计方向与原则

**「墨线」**：纸色画布、白色面板、墨色文字与主按钮，发丝线分层。朱砂（`accent`）只做印记：品牌方印、当前导航的下划线、键盘焦点环、「需你处理」的计数 chip、危险确认按钮——不做链接色、成功色，也不做「完成性」按钮色。状态色只给状态：琥珀 = 等待外部（待到货、未付款、提醒），蓝 = 轮到你处理 / 进行中 / 文字链接，绿（`teal`）= 完成 / 成功 / 正常，红 = 错误 / 危险。层级靠**字号、字重与留白**，不靠阴影和色块。

五条原则（冲突时按顺序取舍）：

1. **一页一个标题**：每页以 `PageHeader` 开头（标题 + 一行说明），右侧放本页动作；一个区域只放一个实心主按钮。
2. **一层容器**：内容直接放在面板上，面板之间用留白分隔；不允许卡片套卡片。
3. **表格就是表格**：表头 surface-2 淡底、12px 不加粗不大写，单行行高 44–48px，发丝线分隔，数字右对齐且等宽（tabular）；行内只放一个描边小按钮 +「…」更多，危险动作不出现在行内。
4. **控件全部自绘**：复选、单选、开关、分段、日期、文件上传都用本规范的组件或全局类，深浅色一致，不露原生外观。
5. **颜色是信息**：数据区域（表格、表单、明细、状态）只有状态和警示上色；不用彩色图标底、渐变、彩色标题。插画只用自绘的「墨线插画」（§5.9）：线描加纸面 / 淡色填充、一幅至多一处朱砂，放在登录、首次使用的空态、完成与办结、404 与页面异常、AI 助手欢迎这些有情绪价值的地方；不用照片、素材库插图和大面积彩色。纹理只有登录页品牌面板的一层纸纹（`.paper-grain`）。

## 2. 令牌与主题

令牌定义在 `main.css` 的 `@theme static`（浅色）与 `@layer base` 里的 `.dark`（深色），具体值见这两处。工具类直接用令牌名：`bg-surface`、`text-muted`、`border-line`、`bg-surface-2/40` …

| 令牌 | 语义 |
| --- | --- |
| `canvas` | 页面画布（纸色），顶栏同色；弹窗页脚底色 |
| `surface` / `surface-2` | 面板、表格、弹窗 / 表头、行悬停（`bg-surface-2/40`）、分段控件轨道、gray chip、图标块、禁用输入框底 |
| `ink` / `text` | 标题、主按钮、大数字 / 正文 |
| `muted` / `faint` | 次要文字 / 元信息、占位与图标；`faint` 在白底上只有 3:1，只给 12px 的辅助信息，需要读清的文字用 `muted` 以上 |
| `line` / `line-strong` | 发丝分隔线 / 控件描边、合计行上线 |
| `primary` / `primary-hover` / `primary-fg` | 主按钮底 = 墨色（深色下近白）/ 悬停 / 实心底上的文字（浅色白、深色墨；朱砂方印与危险按钮上的字也用它） |
| `primary-soft` | 中性的选中底（选中行、AI 建议问题药丸） |
| `accent` / `accent-hover` / `accent-soft` | 朱砂：品牌方印、当前导航下划线、焦点环、必填星号、需处理计数（`Badge tone="accent"`、当前页签的计数）、危险实心按钮（`danger`）与危险文字（`danger-ghost`） |
| `teal` / `teal-soft` | 成功绿：已办结、成功、正常（独立的颜色，不再是 `accent` 的别名） |
| `blue` / `amber` / `red`（及 `-soft`） | 待处理 / 进行中 / 文字链接 / 信息；等待 / 提醒；错误 / 危险（浅色下 `red` 与 `accent` 同值，语义不同：出错用 `red`，印记用 `accent`）；`-soft` 是同色柔底 |
| `panel` / `panel-soft` / `panel-red` | 深色浮层（Toast、批量操作条），两个主题下都保持深色；`panel-red` 是错误 Toast 的深朱砂底 |
| `paper` | 两个主题都是白：原件预览的纸底（透明的截图、扫描件按白纸显示）、开关关闭时的圆钮；不要用 `bg-white` |
| `scrim` | 弹窗与抽屉的遮罩，用全局类 `.overlay`（浅色 40% 墨色，深色 60% 纯黑）；不要再写 `bg-ink/40 dark:bg-black/60` |
| `--radius-card` / `--radius-control` | 面板与卡片 10px / 按钮与输入框 6px；弹窗 `rounded-xl`（12px），状态 chip `rounded-sm`（4px），药丸 `rounded-full` |
| `--shadow-xs` / `--shadow-card` / `--shadow-pop` | 经 `--elevation-*` 间接取值：Tailwind 会把命名阴影的值内联进工具类，直接在 `.dark` 覆盖 `--shadow-*` 无效。面板与按钮都没有阴影；只有弹窗、下拉、Toast 用 `shadow-pop`，分段控件的当前项用 `shadow-xs` |
| `animate-fade-in` / `animate-pop-in` / `animate-sheet-in` | 遮罩 / 下拉与弹层（也给登录面板的首帧）/ 底部抽屉的进场动效，时长与曲线见 `main.css` |
| `animate-stamp-in` | 方印盖下来（180ms，从放大、透明落到原位）：只用于导入「已确认导入」的「入账」印。不做路由切换过渡：这是录入工具，切页靠即时渲染与 `<main>` 回顶，过渡会让回顶和钉住的元素时序变复杂 |
| `--font-sans` / `--font-mono` | 系统中文字体栈（Segoe UI、PingFang SC、Microsoft YaHei …，不引网络字体）/ 流水号、备份文件名与代码 |

文字层级：

| 角色 | 写法 |
| --- | --- |
| 页标题 `h1`（PageHeader） | 桌面 24px、手机 22px / 700 / `tracking-[-0.01em]` / `text-ink`；流水号当标题时 `mono`（等宽 600） |
| 页说明 | 13px `text-muted` |
| 区块标题 `h2`（Panel） | 15px / 600 / `text-ink`；区块说明 13px `text-muted` |
| 弹窗标题 | 18px / 700 / `text-ink`（确认弹窗 16px / 700）；弹窗内分组标题 13px / 600 |
| 正文 | 14px `text-text`，行高 1.5 |
| 表格 | 13px；表头 12px / 500 / `text-muted`，surface-2 底，不加粗不大写 |
| 表单 label | 12.5px / 500 / `text-text`，在字段上方；必填星号朱砂 |
| 元信息 `.text-meta` | 12px / 18px，默认 `faint`，可叠颜色类；「部门 · 经办人 · 日期」用「·」分隔 |
| 指标数字 | 报表核心数字 34px / 700；工作台概览 26px / 700；表格内重点数 15px / 600；都 `tabular-nums` |
| 数字 `.num` | 只加 `tabular-nums`，不换等宽字体；金额 ¥ 前缀、千分位、两位小数；流水号用 `font-mono` |

深色模式：

- 只改令牌：`html.dark` 下 `.dark` 块覆盖令牌值，工具类自动翻转；朱砂与状态色提亮一档保证对比度。页面颜色只用令牌；`dark:` 变体只留给令牌表达不了的少数细节（分段控件当前项；遮罩已是 `scrim` 令牌）。
- `html.dark { color-scheme: dark }`，原生日期面板、滚动条、`<select>` 弹层跟着变深。
- 面板靠 1px `line` 描边分层，不靠阴影；`shadow-pop` 与 `shadow-(--shadow-pop)` 两种写法都跟随主题。
- 实心底上的字用 `text-primary-fg`（`bg-primary text-primary-fg`，Button 已处理；朱砂方印同理）；不要写 `bg-primary text-white`，深色下 primary 近白。深色浮层（`bg-panel` / `bg-panel-red`）两个主题都是深底，上面的字用 `text-white`。
- 局部翻转：深色浮层（Toast 图标、批量操作条）在子树上挂 `.dark`，令牌就地换成深色主题的值。
- 主题由 `useThemeStore` 管理，`localStorage` 键 `canglin-theme`（`light` / `dark` / `system`）；`index.html` 在首帧前预置 `.dark`，避免闪烁；`<meta name="theme-color">` 跟着换成 canvas 色。

## 3. 布局与外壳

外壳全部由 `AppShell.vue` 负责，页面只管 `<main>` 里的内容。没有侧栏。

**桌面（≥ `lg`）**

- 56px 顶栏（`bg-canvas`，底边发丝线），左右留白与内容对齐（`px-(--main-px)`）：
  - 左：朱砂方印（28px、4px 圆角、「仓廪」11px / 700）+ 词标「仓廪」15px / 600 + 12px faint「采购与领用」，整块链接到工作台（`aria-label="仓廪 工作台"`）。
  - 中：`<nav aria-label="主导航">` 六项——工作台、申请单、库存与领用、导入单据、报表、设置。14px muted；当前分区墨色 600，并在顶栏底线上画 2px 朱砂下划线。当前分区按路径前缀判断（`/requests/:id` 也算「申请单」）：恰好是这一页 `aria-current="page"`，分区里的下级页 `aria-current="true"`。
  - 右：实心主按钮「导入 OA 单」（在导入页换成二级按钮「查看申请」，不做自我跳转）、AI 助手图标按钮、深浅色图标按钮、账号圆标（`Menu`：「退出登录」）。
- 页标题只在 PageHeader 里；页面里不要再做导入、AI、主题、退出入口。

**手机（< `lg`）**

- 52px 顶栏：方印 + 词标，右侧 AI 助手图标按钮和主动作（「导入」，导入页里换成「申请」）。
- 60px 底部标签栏（另加安全区，`<nav aria-label="主导航">`）：工作台 / 申请 / 库存（可访问名称「库存与领用」）/ 报表 / 更多。当前项墨色 600、图标朱砂。「更多」是底部抽屉，放底栏放不下的导航（设置）以及深浅色切换、退出登录；当前页在设置里时「更多」也显示为当前项。
- 路由路径变化时外壳收起「更多」，并把 `<main>` 滚回顶部。
- AI 助手抽屉（`AiPanel`）与手机「更多」抽屉都用 reka 的 `DialogRoot / DialogPortal / DialogOverlay / DialogContent`：焦点圈在抽屉里，Esc 与点遮罩关闭，关闭后焦点回到触发按钮；都有 `DialogTitle` 与 `DialogDescription`（「更多」的说明是 sr-only）。AI 抽屉打开后聚焦输入框，未启用时聚焦「前往设置」；还没有对话时建议问题上方是一幅 `brush` 插画（一页账、砚台与毛笔）。
- 标签页标题由 `router.afterEach` 写成「{meta.title} · 仓廪」（`utils/title.ts`；登录页「登录 · 仓廪」），申请详情数据到位后改成「{流水号} · 仓廪」。
- `<router-view>` 外包一层 `RouteErrorBoundary`：页面组件渲染或 setup 抛错时原位居中显示墨线插画（`spill`，打翻的墨水瓶）+「页面出现异常」+「重新加载」，路由变化时重置；事件处理与异步回调的错误不接管，照旧由 `main.ts` 的全局兜底弹 toast。

**会话过期**：外壳挂着 `SessionExpiredDialog`（经 `api/client` 的 `onSessionExpired` 注册）。请求返回 401 且前端仍是登录态时，先弹「会话已过期，请重新登录」（确认框排版 + 密码框，`persistent`），登录成功后拦截器把失败的请求重放一次，页面上填了一半的弹窗不丢；选「去登录页」、重放仍 401、上传（`FormData`）和 `/auth/*` 接口照旧跳登录页。登录、初始化、恢复码登录这几个未登录时核对凭据的接口返回 401 表示密码不对，不当成会话过期（`isCredentialCheck`），由页面在字段旁说明；改密、重置恢复码输错密码时服务端返回 403，同样在字段旁说明。

**`<main>` 是唯一的滚动容器**。外壳内边距变量声明在外壳根元素上（顶栏和 `<main>` 共用，`<main>` 自己的 padding 就读这些变量）：

| 变量 | 手机 | 桌面 | 用途 |
| --- | --- | --- | --- |
| `--main-px` | 16px | `max(32px, (100vw − 1536px) / 2)` | 左右留白；宽屏时把内容居中，版心最宽 1536px |
| `--main-pt` | 16px | 28px | 顶部留白 |
| `--main-pb` | 96px（另加安全区） | 48px | 底部留白；手机上给底部标签栏让位 |

- 抵消外壳留白只引用变量：通栏 `-mx-(--main-px) px-(--main-px)`、撑到底边 `lg:-mb-(--main-pb)`、贴顶 sticky `-top-(--main-pt)`；不要写死 `-mx-4`、`-top-8` 这类数值。
- 页面根元素不加外边距；表格随内容自然增高，不用 `h-full flex-1 min-h-0` 撑满屏。
- `<main>` 带 `relative`：没有定位祖先的 `absolute` / `sr-only` 元素以它为包含块并跟着滚动，不会把文档撑出第二个滚动条。
- 滚动的是 `<main>` 而不是 window，路由的 `scrollBehavior` 不起作用；只改 query 的页内切换不会自动回顶，需要时由页面自己滚动 `<main>`（导入页切换任务就是这样）。
- 内容宽度：正文最宽 1536px（由 `--main-px` 实现；宽屏上少留白，导入页的原件预览与明细、长品名与规格有更多地方。不按页面区分——顶栏与内容共用这个变量，切页时导航不会左右跳）；设置（`/settings` 与供应商、审计两个子页）由 `SettingsLayout` 排成「左 200px 子导航 + 右侧内容最宽 760px」。
- **PageHeader 每页一个**：设置的页头「设置」与子导航（`<nav aria-label="设置分区">`）由 `SettingsLayout` 统一给出，`/settings`、`/settings/suppliers`、`/settings/audit` 里不再放 PageHeader。
- **StickyActionBar** 钉在 `<main>` 底边：桌面贴视口底边，手机贴在底部标签栏之上；内容不满一屏时跟在内容后面。
- **钉表头**：`.table-sticky` 默认相对 `<main>` 钉住（桌面贴顶栏下沿、手机贴顶栏下沿）；表格放在自己的 `overflow-auto` 纵向滚动容器里时钉在容器顶边。表格和 `<main>` 之间只要夹着别的滚动容器（`overflow-x-auto` 外层、`overflow-hidden` 面板），表头就钉不住——横向滚动与钉表头不能兼得，这是 CSS 的限制。需要钉时让外层在放得下时 `overflow-visible`（可用容器查询，如 `@min-[1080px]:overflow-visible`），面板用 `Panel`（`overflow-clip` 不是滚动容器）。

## 4. 响应式与手机规则

- 断点：`lg`（1024px）以上是桌面外壳；`sm`（640px）以上表单双列、表格按表格排；`< 640px` 表格改为卡片（`.table-cards`）。
- 触控目标 ≥ 40px：`.row-action` 在触屏（`hover: none`）下放大到 40px 并常亮；底栏每项 60px 高；FileDropzone 的「拍照上传」是整宽 `lg` 按钮。`pointer: coarse` 下 Pagination 页码按钮、登记采购的历史价药丸、设置子导航的手机药丸加高到 40px；Select / SearchInput 的清空按钮视觉仍是 24px，用伪元素（`pointer-coarse:before:absolute pointer-coarse:before:-inset-2`）把点击区扩到 40px。自己写的小按钮照此处理。
- `.table-cards`：`<table class="table-base table-cards">`，每个 `td` 写 `data-label="列名"`（用列头原文）。
  - 没有 `data-label` 或为空串的格整行显示（品名这类主字段）；主字段不在第一列时给它加 `card-title` 排到卡片首行；操作格加 `card-actions`，成为卡片底部的操作行。
  - `td` 上桌面专用的工具类（`pl-5`、`py-*`、`w-full max-w-0`、`whitespace-nowrap` …）一律加 `sm:` 前缀，否则会压过卡片规则；卡片里要显示的列不要用 `hidden sm:table-cell`。
  - 不要用 `before:` 变体改列名样式（Tailwind 会注入空的 `content`，列名消失）；列名固定 `font-normal`，单元格的字重写在内部 `<span>` 上。
  - 卡片模式下表头只留给读屏，表头里的控件（全选框）在手机上要另给入口。

```vue
<table class="table-base table-cards min-w-[700px]">
  <thead><tr><th>物品</th><th>分类</th><th class="text-right">当前库存</th><th class="text-right">操作</th></tr></thead>
  <tbody>
    <tr v-for="p in products" :key="p.id">
      <td><span class="font-medium text-ink">{{ p.name }}</span></td>
      <td data-label="分类"><Badge>{{ p.category }}</Badge></td>
      <td data-label="当前库存" class="text-right num"><span class="font-semibold">{{ p.stockQty }}</span></td>
      <td class="card-actions">
        <button type="button" class="row-action" title="编辑" @click="edit(p)"><Icon name="edit" :size="16" /></button>
      </td>
    </tr>
  </tbody>
</table>
```

- KPI 行在手机上通栏横向滑动（`snap-x`），桌面是网格。
- 弹窗在 `< sm` 默认全屏、无圆角，页脚让开安全区；只有 `ConfirmDialog` 保持居中小卡片。
- 输入框在手机上高 44px、用 16px 字（`h-11 sm:h-9 text-base sm:text-sm`，Input / Select / NativeSelect / SearchInput 已处理），避免 iOS 聚焦时整页放大；自己写的输入控件照此处理。手机上的主动作按钮可加高到 44px（`max-sm:h-11`）。
- PageHeader 与 Panel 头部的动作在窄屏换到标题下一行、靠左。
- 导入页在 `< lg` 用分段 Tabs 在「明细 / 原件」之间切换。
- 底部有三样固定 / 粘性的东西：底部标签栏、StickyActionBar（已按标签栏高度偏移）、Toast（手机上居中叠在标签栏之上，最多 4 条，数秒后消失）；页面不要再加新的底部固定元素。

## 5. 组件选用与速查

组件都在 `@/components/ui/`。下面是选用原则和关键 API，完整签名以源码为准。

### 5.1 Button 与 buttonClass

- `variant`：`primary`（墨色实心主动作，一个区域只放一个；没有阴影）、`secondary`（默认，surface 底 + line-strong 描边，悬停 surface-2）、`ghost`（无底 muted，工具按钮、弹窗「取消」）、`danger`（朱砂实心，**只**用于确认弹窗里的危险动作）、`danger-ghost`（朱砂文字，低强调的危险动作，如申请明细的「删除第 N 行」）、`accent`（旧名字：「确认入账 / 确认发放 / 确认全部内容并导入」这类完成性动作，和 `primary` 同样式——完成的反馈靠 Toast 和绿色 chip，不靠按钮颜色；保留名字只为不改调用方，新代码直接写 `primary`）、`link`（文字链接，见下条）。
- `link`：蓝色文字、悬停下划线，没有高度、内边距和边框，字号字重随上下文（需要时调用方加 `text-xs` / `font-medium`）；`size` / `iconOnly` / `pressed` 对它不起作用。用于行内的次要动作（「来源明细 #12」、错误行后的「重试」），不再手写 `text-blue hover:underline` 的按钮；跳转用的文字链接（`router-link` / `<a>`）同样套 `buttonClass({ variant: 'link' })`。
- `size`：`sm`（28px，表格行内、工具栏）、`md`（34px，默认）、`lg`（40px，登录与整宽主动作；手机上的主动作再加 `max-sm:h-11` 到 44px）。触控设备（`pointer: coarse`）下三档自动加高到 40 / 44 / 44px，图标按钮同样放大，页面不用再为触屏单独写高度。`iconOnly`：正方形图标按钮（28 / 34 / 40），必须配 `aria-label`。
- 交互：悬停 primary → `primary-hover`、secondary / ghost → surface-2 底；键盘焦点 2px 朱砂外框（外扩 2px）；按下缩放 0.98；禁用 50%。
- `pressed`：开关按钮（「只看低库存」「筛选」）。传了才渲染 `aria-pressed`，`true` 时换成 surface-2 底 + 墨色字。按钮已经带 `aria-expanded`（展开器）时只借样式、不加 `aria-pressed`——一个按钮不该既是开关又是展开器。
- `loading`（转圈并禁用，不加全屏遮罩）、`disabled`、`type`（默认 `button`）。
- 长得像按钮的链接（`router-link` / `<a>`）用同一套类：`buttonClass({ variant, size, iconOnly, pressed })`，从 `@/components/ui/button` 引入。

```vue
<Button variant="primary" :loading="busy" @click="confirm">确认全部内容并导入</Button>
<Button variant="ghost" icon-only aria-label="刷新" @click="load()"><Icon name="refresh" :size="16" /></Button>
<Button size="sm" :pressed="!!state.low" @click="toggleLow">只看低库存</Button>
<router-link to="/requests" :class="buttonClass({ variant: 'secondary', size: 'sm' })">查看申请</router-link>
<Button variant="link" class="text-xs" @click="emit('source', line.sourceLineId)">来源明细 #{{ line.sourceLineId }}</Button>
```

### 5.2 Input / Textarea / SearchInput / Select / NativeSelect

- 外观统一来自全局类 `.control`（`main.css`）：surface 底 + line-strong 描边，悬停加深；聚焦（Select 展开时也算）= 墨色描边 + 3px 墨色淡环；`aria-invalid="true"` 时转错误态（红框 + 淡红底，聚焦环变红）；禁用 surface-2 底。组件传了 `error` 就会带上 `aria-invalid`，并经 `aria-describedby` 指向字段下方的错误（`useId()` 生成 id；没有错误时指向 `hint`，两者都没有就不加）——读屏能听到原因，不只是「无效」。表格式明细里隐藏的 `.field-error` 照样被引用。页面里手写的输入框（AI 对话框、导入明细单元格）也套 `class="control"`，不再手写 `border-* focus:ring-*`。
- 高度：`md`（默认）桌面 36px、手机 44px 且 16px 字；`sm` = 32px（表格行内与明细行）。触屏（`pointer: coarse`）上 Input / Select / NativeSelect / SearchInput 自动加高：`sm` 40px、`md` 44px（宽屏触屏也是），页面不要再为触屏单独改高度。字段比同档的 Button（28 / 34）高 4px 是刻意的：输入框要放 16px 的手机字号与 3px 聚焦环，按钮只放一行 13px 字；表格行内需要和 sm 按钮同高时用 NativeSelect `sm`（28px）。label 在字段上方，12.5px / 500；必填星号朱砂；占位 faint；字段错误贴在字段下方（`.field-error`：12.5px 红字 + `alert-circle` 图标）。
- `Input`：`label`、`required`、`hint`、`error`、`suggestions`（datalist）、`size`、`hideLabel`（label 只留给读屏，列头已说明字段时用）、`variant`（`cell` = 表格式输入的单元格：平时无框无底，悬停显描边，聚焦墨色环，出错仍是红框；配 `size="sm"` 与 `hideLabel`，手写时是 `class="control control-cell"`）；事件 `update:modelValue`、`blur`、`enter`。根元素是 `<label>`，外部传的 `class`、`aria-label`、`@change` 落在 label 上。`type="date"` 自动套 `.input-date`（右侧日历图标、点整个框打开、空值占位变淡），不要再给它写 `px-*`。
- `Combobox`（reka 弹层，可以输入的下拉）：值就是框里的文字，下拉只是用过的写法——部门、经办人、领用人、人工录入的品名与规格都用它（docs/manual-entry-2026-10.md P2）。`options: (string | { value, note? })[]`（调用方排好序，最近用的在前；`note` 是右边 12px muted 小字，如人员的部门、品名的单位）、`label`、`hint`、`error`、`size`、`hideLabel`、`variant`（与 `Input` 同义，外观同是 `.control`）、`openOnClick`（默认点框就展开；表格单元格里传 `false`，箭头与方向键照样能展开，`cell` 时箭头悬停 / 聚焦才显）、`limit`（默认 50）、`emptyText`；事件 `update:modelValue`、`select`、`blur`。点框或箭头展开时列出全部（当前值在前），打字才按包含的文字筛（全角半角、空格不计，开头相同的在前）；打了字时第一行是「照打的字」（右边「新的」，`data-typed`），reka 会自动高亮第一行，所以打完直接回车留下打的字，方向键往下才选已有的。输入法组字时不改值。点开以后没打字、没按方向键就回车只关下拉、不选（不会误填最近用的那一个）；Home / End 在框里移动光标，不做列表导航。弹层走 portal、`z-50`，在 `Dialog` 里是嵌套层（点选项不关弹窗，Esc 先关下拉）。不要用 `Input` 的 `suggestions`（datalist）做部门、人员：要先打字才出现，看不出能选；datalist 只留给单位这类短候选。
- `Textarea`：`label` / `hint` / `error` 与 Input 一致，`rows` 默认 3。
- `SearchInput`：搜索图标固定在左；停止输入 `delay`（默认 350ms）后发 `search`；`delay` 为 0 时只在回车时搜；Esc 清空；`disabled` 时输入框禁用、不显示清空按钮。放在工具栏最左，宽 `w-72`–`w-80`（300–340px）。
- `Select`（reka 弹层）：表单里的单个选择；`options: { label, value }[]`、`clearable`、`error`、`size`（`sm` 与 `Input size="sm"` 同高）。`value` 为空串的选项会当成占位文字（reka 不接受空串值），清空走 `clearable`。
- `NativeSelect`：表格行内、批量条这类高密度位置（不挂 portal，手机上是原生滚轮）；`size="sm"`（28px）用于表格行内，手机上字号仍是 16px（iOS 聚焦小于 16px 的控件会整页放大），≥ 640px 才是 12px；`placeholder` 渲染为空值选项。

```vue
<Input v-model="l.quantity" size="sm" variant="cell" type="number" label="第 1 行申请数量" hide-label />
<Select v-model="supplierId" label="本次供应商" :options="supplierOptions" clearable />
```

### 5.3 Checkbox / Switch / 单选

- 都是原生 `<input>`（`appearance: none` 自绘），role、键盘、label 关联都是原生的；Switch 底下也是 checkbox，role 仍是 checkbox，Playwright 的 `check()` / `uncheck()` 照常可用。
- 选中色是墨色：复选、单选选中 = 墨色实心（深色下近白，勾与圆点用 `primary-fg`）；Switch 开 = 墨色轨道。键盘焦点沿用全局 2px 朱砂外框；禁用 50%。
- `description` 走 `aria-describedby`，不进可访问名称；补充说明不要塞进 `label`：名称保持简短，读屏先读名称、再读说明。
- Checkbox：`v-model` 绑布尔，或配合 `value` 绑数组 / Set（返回新数组 / 新 Set）；也可以 `:checked` + `@change`（原生事件）受控；`indeterminate`；`size="sm"`（14px）。有 label / description / 插槽时整行是 `<label>`，否则只渲染 input，此时必须给 `ariaLabel`。
- 单选不封装组件，直接用全局类 `<input type="radio" class="radio">`（见下条）：同组传同一个 `name`；`change` 只在被选中时触发。
- Switch：`labelPosition="left"`（设置行文字在左、开关在右，配 `class="w-full justify-between"`）；没有 `size`。
- 表格行内可以直接用全局类 `<input type="checkbox" class="checkbox">` / `class="radio"`（14px 加 `checkbox-sm` / `radio-sm`），尺寸固定，不要叠 `size-*` / `accent-*`。

```vue
<Checkbox v-model="line.selected" :label="line.itemName" :description="`可操作 ${quantityLabel(line.available, line.unit)}`" />
<Checkbox v-model="selected" :value="row.id" :aria-label="`选择 ${row.itemName}`" />
```

### 5.4 Tabs

- `Tabs`（按值切换）：`tabs: TabItem[]`（`value`、`label`、`count?`、`icon?`、`disabled?`）；`block`（撑满一行、各项等宽）；`ariaLabel`（整组 `role="group"`）；`disabled`（整组禁用，如保存中不许切换退货方式）。每项是普通 `<button>`，当前项 `aria-pressed="true"`；事件 `update:modelValue`、`change`（点当前项不触发）。
  - `variant="segmented"`：surface-2 轨道（2px 内边距、6px 圆角）+ 当前项白底轻阴影；用于列表筛选（「全部 · 有待采购 · 有待到货 …」）、面板顶部的视图切换和分段控件。`count` 是跟在标签后的小号数字，当前项的计数朱砂。
  - `variant="underline"`（默认）：只配合页级分区；当前项墨色 600 + 底部 2px 朱砂下划线（左右各收 12px）；`count` 是小药丸（surface-2 底），当前项变朱砂柔底。
  - `count` 会并入按钮的可访问名称（「有待采购 2」）；按名称找页签的测试要允许计数（`/^库存物品( \d+)?$/`）。
- 按 query 区分的列表行（如 `/import?task=…`）不要直接用 `<router-link>`：它判断「当前」时不看 query，会给每一行都加 `aria-current="page"`。用 `custom` 插槽自己渲染 `<a>`，「当前」由页面标注。

```vue
<Tabs :model-value="tab" variant="segmented" :tabs="[{ value: 'pending', label: '未完成', count: 3 }, { value: 'confirmed', label: '已入账' }]" @change="switchTab" />
<Tabs v-model="mobileTab" variant="segmented" block class="lg:hidden" :tabs="[{ value: 'draft', label: '明细' }, { value: 'original', label: '原件' }]" />
```

### 5.5 PageHeader / Panel / StickyActionBar

- `PageHeader`：`title`、`description?`、`mono?`（流水号当标题时用等宽字）；默认插槽 = 本页动作（右侧，窄屏换行靠左）；`#meta` 放标题上方的小字（面包屑「申请单 / 流水号」、「示例数据」chip）；`#status` 放紧跟在标题右边的状态 chip——在 `h1` 之外，不进标题的可访问名称（标题只读流水号）；`#description` 替代说明文本（需要链接或高亮数字时）。标题 24px / 700（手机 22px），说明 13px muted；自带 `mb-6`，页面不再给它外边距。
- `Panel`：一层面板（`.card`：surface 底 + 1px line + 10px 圆角，无阴影；`overflow-clip`：按圆角裁掉贴边内容，但不是滚动容器）；`title?`（h2，15px / 600）、`description?`、`flush`（body 无内边距，表格与列表贴边）、`bodyClass`（整体替换 body 的类，默认 `p-5`）；插槽 `#actions`（头部右侧，放 sm 按钮；放 ghost 按钮时加 `-mr-2`）、`#toolbar`（头部与 body 之间的工具栏行：`flex flex-wrap items-center gap-2.5 px-4 py-3` + 底部发丝线：搜索框最左，分段 Tabs 筛选，右侧 `ml-auto` 放计数 / 排序 / 动作；不传不渲染）、默认、`#footer`（分页、计数；`px-4 py-2.5` + 顶部发丝线，插槽什么都没渲染时整条隐藏——total 为 0 的 Pagination 就是这样）。有 `title` 时根元素 `<section>` 经 `aria-labelledby` 以标题命名，是读屏可以跳转的区域（测试用 `getByRole('region', { name })` 找面板）。新写的面板优先用它。
- `StickyActionBar`：页面底部的保存 / 确认条；默认插槽放按钮（靠右，手机整宽加 `max-sm:flex-1`），`#start` 放提示与错误（用 `Notice variant="inline"`，`role="alert"` 由调用方给；什么都没渲染时整块隐藏）。

```vue
<PageHeader :title="request.serialNumber" mono :description="`${request.department} · 经办人 ${request.handler}`">
  <template #meta><router-link to="/requests" :class="buttonClass({ variant: 'link' })">申请单</router-link></template>
  <template #status><Badge tone="blue">待处理 4 包</Badge></template>
  <Button variant="primary" @click="purchasing = true"><Icon name="plus" :size="16" />登记采购</Button>
</PageHeader>
<Panel title="备份管理" description="恢复会覆盖当前数据库与附件，操作前请先创建备份" flush>
  <template #actions><Button variant="secondary" size="sm" @click="createBackup">创建备份</Button></template>
  <div class="max-h-96 overflow-auto"><table class="table-base table-sticky">…</table></div>
</Panel>
```

### 5.6 FileDropzone

- 点击或拖入上传。内部始终只有一个 `<input type="file">`（`sr-only`，整块是可键盘聚焦的 `<label>`），测试直接对它 `setInputFiles`，和用户选文件走同一条路径。
- 外观：surface 底 + 1.5px line-strong 虚线、12px 圆角；48px surface-2 图标块 + 15px / 600 标题 + 12px faint 限制说明；悬停描边加深、拖入时描边墨色 + surface-2 底；键盘焦点是全局的朱砂外框。`art`（只给导入页撑高的上传态）：≥ 640px 用 96px 的墨线插画（`scan`，单据 + 扫描线）代替图标块，拖入时主线换成墨色；手机与页尾的紧凑上传框不传，仍是图标块。
- props：`accept`（拖入的文件也按它过滤）、`multiple`（默认只交出第一个文件）、`label`、`hint`、`disabled`、`capture`（手机上多一个「拍照上传」，临时给同一个 input 加 `capture`）；默认插槽追加在文案下方。
- 事件：`files(File[])`（交出后清空 input，同一文件可以再选）；`rejected(File[])`——组件已经弹了错误 Toast（「不支持的文件类型，请选择 …」，格式名按 `accept` 生成：`.pdf` → PDF、`.jpeg` 并入 JPG、`image/*` → 图片），调用方不要再弹。组件用到 toast store，单测挂载需要活动的 pinia（见 `FileDropzone.spec.ts`）。

### 5.7 Badge / Pagination

- `Badge`（状态 chip）：22px 高、4px 圆角、柔底同色字、不描边、12px / 500；文字尽量带数量（「待处理 4 包」优于「进行中」）。`tone`：`gray`（默认，未开始 / 中性：待采购、未开票）、`amber`（等待外部：待到货、未付款）、`blue`（轮到你处理：待处理）、`teal`（完成：已办结、正常）、`red`（错误）、`accent`（朱砂柔底：只给需处理计数与「示例数据」这类印记）、`outline`（只有描边：已撤销）；已取消用 gray 再加 `class="line-through"`。`dot`：文字前 6px 圆点。根元素带 `.badge`，表格里 `td:has(.badge)` 自动收紧上下留白，单行行高保持 44px。
- `Pagination`：`page`（可 `v-model:page`）、`pageSize`（默认 20）、`total`；事件 `change(page)` 与 `update:page`（同时发出）；放在表格面板的 `#footer`。左边「第 1–20 条 · 共 128 条」，右边页码（当前页墨色实心小方块，在 `<nav aria-label="分页">` 里）。`total` 为 0 时整个组件不渲染，放在 Panel 页脚里时页脚也跟着隐藏，不出现「第 0–0 条」。

### 5.8 Dialog / ConfirmDialog

- `Dialog`：`open`（`update:open`）、`title`、`description?`（头部一行说明）或 `#description` 插槽（放在正文开头，ConfirmDialog 的 message 走这里）——两者都包在 reka 的 `DialogDescription` 里由 `aria-describedby` 朗读；都没有时弹窗不带 `aria-describedby`（不指向不存在的节点）、`width`（默认 560px；带明细表的登记弹窗 760–880px）、`dirty`（有未保存改动时关闭前二次确认）、`persistent`（只能用明确的按钮关闭，如恢复码）、`mobileFullscreen`（默认 `true`）、`compact`（确认框排版，ConfirmDialog 用）；默认插槽 + `#footer`（按钮靠右，可先放一段 `mr-auto` 小字；插槽参数 `{ close }` 就是右上角 × 用的关闭入口，同样先过 `dirty` / `persistent`）。外观：12px 圆角、`shadow-pop`；头部 18px / 700 标题 + 13px 说明，底边发丝线；正文左右 24px；页脚 canvas 底、顶边发丝线。遮罩在 pointerdown 时关闭，从面板拖选文字到遮罩不会误关；Esc 先取消内层的放弃确认。手机上全屏、页脚钉底。
- 表单弹窗的页脚从左到右：提示或失败原因（失败用 `Notice` inline + red + `role="alert"`，`class="mr-auto self-center"`）→「取消」（ghost，`@click="close"`，保存中 `disabled`）→ 主动作（primary）。「取消」必须走 `close`，直接 `emit('update:open', false)` 会绕过未保存确认。单测里替换 Dialog 的桩要给 `#footer` 传参（`slots.footer?.({ close })`），否则解构 `{ close }` 的插槽会抛错。
- `ConfirmDialog`：一句话确认；`message`（写清后果与影响数量）、`confirmText`、`danger`（朱砂实心确认按钮）、`loading`、`confirmDisabled`（有下游依赖、不能直接执行时禁用确认按钮）；默认插槽追加在 message 之后（下游依赖的 Notice、撤销原因输入框）；事件 `confirm`、`update:open`。`loading` 时确认按钮转圈、「取消」禁用，Esc 与遮罩也关不掉（内部传 `persistent`），结果出来前不会被误关；在途时调用方仍要忽略重复的 `confirm`。message 走 Dialog 的 `#description`，由 `aria-describedby` 朗读。宽 420、16px / 700 标题、没有分隔线和 ×（「取消」、Esc、遮罩照样能关），手机上不全屏。

```vue
<Dialog :open="open" title="盘点调整" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
  …
  <template #footer="{ close }">
    <Notice v-if="failure" role="alert" tone="red" variant="inline" class="mr-auto self-center">{{ failure }}</Notice>
    <Button variant="ghost" :disabled="saving" @click="close">取消</Button>
    <Button variant="primary" :loading="saving" @click="submit">确认盘点调整</Button>
  </template>
</Dialog>
```

### 5.9 EmptyState / ErrorState / Skeleton / Toast

- `EmptyState`：44px surface-2 圆角图标块 + 15px / 600 标题 + 13px muted 一句话 + 最多两个 sm 按钮（默认插槽），上下 40px。`icon`（默认 `box`；`false` = 不画图标块）、`art?`（墨线插画，传了就代替图标块，默认不画）、`title`、`description?`；`illustration`（`box`、`ledger`、`truck`、`search`、`empty`）是旧的场景名，现在只换成对应的线性图标，新代码直接传 `icon`。三种用法：首次使用 = 图标（重要的几处用 `art`）+ 一句话 + 两个入口（primary sm + secondary sm）；搜索 / 筛选无结果 = `icon=false`、不传 `art`，标题复述条件，给「清除全部条件」(secondary sm)/「只清除关键词」(ghost sm)；待办已清空 = 页面里一行提示（工作台的「今天的待办都处理完了」左边配一幅 `rest` 小插画），不占多少高度。
- 「墨线插画」`LineArt`（`components/ui/LineArt.vue` + `art.ts`）：自绘的内联 SVG，颜色全部来自令牌、深浅色自动换，不引图片或插画库。每幅是按绘制顺序排列的一组形状（后画的盖住先画的）：主线 currentColor（调用方给 `text-faint`，拖入、强调时可换墨色）、细线 `line-strong`（文字行、地面线）、填充 `paper`（surface 纸面）/ `shade`（surface-2）/ `ink`（墨）/ `amber`·`teal`·`blue`（对应 `-soft` 淡色，深色下先垫一层纸面，不透出后面的线）、朱砂一幅至多一处（印、匾、标签、终点），另有虚线（「空位」）。描边 2px 不随尺寸缩放、圆角线帽、`aria-hidden`；默认视窗 120 × 96，场景图另给 `box`。`size` 是宽度。
  - 母题与位置：首次使用的空态 96px——申请单与工作台「还没有申请单」`ledger`、库存「还没有库存物品」`shelf`、备份 `archive`、导入任务列表 `inbox`、报表「还没有成交记录」`report`、供应商 `shop`；导入页撑高的上传框 `scan`；工作台待办清空 `rest`（112px）；AI 助手还没有对话时 `brush`（104px）；404 `lost`（200px）；页面异常 `spill`（200px）；登录页左栏场景 `granary-scene`（340px），手机登录表单上方 `granary`（72px，矮屏不显示）。
  - 不用照片、素材库插图、渐变和大面积彩色；搜索 / 筛选无结果不画。新增母题照 `art.ts` 的助手与规格画，并在浅 / 深色下截图核对。
- `ErrorState`：原位的加载失败——朱砂 `alert-circle` + `title`（默认「加载失败」）+ `message` +「重新加载」（secondary sm，`loading` 时转圈并禁用；旧名 `retrying` 已改）；默认插槽追加在「重新加载」之后（如「查看系统状态」ghost sm）；事件 `retry`。不带 role（页面同时只该有一个 alert）。
- `Skeleton`：surface-2 条块，用尺寸类拼出占位形状（`<Skeleton class="h-4 w-40" />`），代替「加载中…」文字；只给首次加载，刷新时保留旧内容。根元素带 `data-skeleton`，测试按它判断「已离开骨架屏」（`animate-pulse` 只是样式）。
- Toast：`useToastStore()` 的 `success(msg, action?)`、`error(msg)`、`info(msg)`；墨色浮层白字（`bg-panel`），成功图标绿、信息图标蓝，错误换成深朱砂底（`bg-panel-red`）；桌面右下、手机居中在标签栏之上，最多同时 4 条；错误是 `role="alert"`，其余 `role="status"`；带动作（如「撤销」）的成功提示停留更久，动作是浅色小药丸按钮。

### 5.10 Icon

- `<Icon name="…" :size="16" />`：内联线性图标（24 视窗、2px 描边），`aria-hidden`；未知名字回退为 `box`。不要引入图标库，缺图标就在 `Icon.vue` 里补 path；不再使用的图标随手删掉（先 grep `name="…"` 与 `'…'` 确认没有引用）。错误用 `alert-circle`（圆），提醒用 `alert`（三角）。
- 现有名字：`dashboard` `ledger` `kanban` `import` `distribution` `inventory` `report` `supplier` `audit` `settings` `plus` `search` `download` `upload` `trash` `restore` `edit` `close` `chevron-left` `chevron-right` `chevron-down` `check` `alert` `alert-circle` `box` `logout` `history` `camera` `file` `key` `clock` `calendar` `refresh` `copy` `image` `filter` `sparkles` `send` `sun` `moon` `upload-cloud` `check-circle` `info` `external` `truck` `layers` `arrow-right` `receipt` `user` `more-horizontal` `arrow-up-right` `clipboard` `scan` `dot`。

### 5.11 Notice / Disclosure

- `Notice`：提醒与错误，代替手写的琥珀 / 红色柔底块和带图标的红字行。
  - `variant`：`box`（默认）是柔底同色字的提示块，放在页面、面板、弹窗正文里，`size="sm"` 是收紧的小块（6px 圆角）；`inline` 只有图标 + 同色字，放在弹窗页脚、StickyActionBar 的 `#start`、字段组下方。
  - `tone`：`amber`（默认，提醒、需要人工处理）、`red`（失败与错误）、`blue`（信息）、`teal`（成功，绿色）。只画文字前一个小图标，`icon` 默认按 tone 取（`alert` / `alert-circle` / `info` / `check-circle`），`false` 不画。
  - `#actions`：box 里放恢复动作（`size="sm"` 按钮），放不下时换到文字下一行；inline 里紧跟在文字后面，只放 `variant="link"` 的文字按钮。
  - 不带 role：错误和必须马上处理的提醒由调用方加 `role="alert"`，进度与结果用 `role="status"`，静态说明不加；`class`（如页脚里的 `mr-auto self-center`）同样落在根元素上。根元素里除了 `aria-hidden` 的图标只有插槽内容，`getByRole('alert')` 读到的就是提示原文。
  - 一条消息一个 alert：同一个错误不要同时出现在页面和操作条里（§7）；多条同类警告放进同一个 Notice 的列表里（`items: { text, icon? }[]`：渲染成 `<ul>`，每条一行、可各带图标，如导入页识别警告的本地 `alert` / AI `sparkles`），不要堆一串 Notice，也不要手写琥珀块。
- `Disclosure`：原生 `<details>` / `<summary>` 折叠区，代替手写的 details。
  - `summary`（或 `#summary` 插槽：图标 + 文字）；默认插槽是展开后的内容。
  - `summaryClass`：标题行的字号、颜色、内边距（如 `px-5 py-3.5 text-sm font-medium text-text hover:text-ink`）。标题行已经是 `flex items-center gap-2`，不要再传 `flex` / `gap-*`：同一属性的两个工具类谁生效看样式表顺序。
  - `chevron`：`start`（默认，标题前 `chevron-right`，展开转 90°）、`end`（标题后 `chevron-down`，`ml-auto` 靠右，展开转 180°）、`none`；`chevronSize` 默认 14，`chevronClass` 整体替换默认的 `shrink-0 text-faint transition-transform duration-150`。
  - `open` 绑定到 `<details open>`：用户点开、收起由浏览器维护，prop 变化时才写回；每次开合发 `update:open`（可以 `v-model:open`）。原生 `toggle` 不声明：`@toggle`（如展开时才加载历史）和 `class` 照样落在根 `<details>` 上。
  - 箭头用子选择器（`details[open] > summary > 箭头`）旋转，嵌套的折叠区互不影响；根元素带 `group/disclosure`，但 `group-open/disclosure:` 是后代匹配，嵌套时外层展开也会命中。

```vue
<Notice v-if="saveError" role="alert" tone="red">
  草稿保存失败：{{ saveError }}。请保留当前页面，避免丢失编辑。
  <template #actions>
    <Button size="sm" variant="secondary" @click="persist">重试保存</Button>
    <Button size="sm" variant="ghost" @click="reloadDraft">重新载入已保存版本</Button>
  </template>
</Notice>
<Notice v-if="ocrOk === false" size="sm" class="mt-5">OCR 不可用时导入页仍能打开，但上传后会解析失败。</Notice>
<Disclosure chevron="end" :chevron-size="16" summary-class="px-5 py-3.5 text-sm font-medium text-text hover:text-ink" @toggle="loadHistory">
  <template #summary><Icon name="history" :size="16" class="shrink-0 text-faint" />草稿修改与识别历史</template>
  …
</Disclosure>
```

### 5.12 Menu

- `Menu`（reka DropdownMenu）：顶栏的账号菜单、表格行尾的「…」更多操作。`items: MenuItem[]`（`label`、`icon?`、`danger?`（朱砂字；危险动作本身仍要走确认弹窗）、`disabled?`、`onSelect?`）、`label?`（菜单顶部的一行小字）、`triggerLabel`（默认触发按钮的可访问名称，默认「更多操作」）、`align`（默认 `end`）。
- 默认触发按钮是「…」图标按钮（ghost sm，28px）；`#trigger` 插槽换成自己的按钮（as-child 合并上 `aria-haspopup` / `aria-expanded` 与事件，必须是单个可聚焦元素）。键盘：回车 / 空格 / ↓ 打开，方向键移动，Esc 关闭并把焦点还给触发按钮。
- 行内动作的写法：一个描边小按钮（下一步）+ `Menu`（其余动作）；危险动作不直接出现在行内。

```vue
<Button size="sm" @click="register(row)">登记到货</Button>
<Menu :items="[{ label: '查看原件', icon: 'file', onSelect: () => open(row) }, { label: '撤销登记', icon: 'restore', danger: true, onSelect: () => confirmVoid(row) }]" />
```

## 6. 通用规则

**表单**

- 字段用 Input / Select / Textarea 自带的 `label`（字段上方）；必填用 `required`（朱砂星号）；补充说明用 `hint`；校验错误用 `error` 显示在字段下方（`.field-error`：12.5px 红字 + `alert-circle` 图标，输入框经 `aria-invalid` 转红框淡红底），不要只靠 Toast。手写的输入控件套全局类 `.control`（§5.2）。
- 前后端共用 `packages/shared` 的 zod 契约，校验信息用中文（如数字的「必须大于 0」「不能为负数」）；新增校验延续中文文案。
- 弹窗表单字段用 `grid gap-4 sm:grid-cols-2`，分组之间 `border-t border-line pt-4` 加 13px / 600 的分组标题；明细（下单登记、到货登记、发放 / 入库 / 退回等数量类弹窗）用 `RegisterLineTable` 表格式明细：列头只写一次，行内控件统一 `size="sm"`，字段错误只在单元格标红框、原因在表下汇总「第 N 行 · 品名：原因」；人工录入申请的逐行录入用无框的 `Input variant="cell"`，错误同样在表下汇总「第 N 行：原因」。
- 表单弹窗的提交状态用 `useDialogForm(() => JSON.stringify(form))`（`@/composables/useDialogForm`）：给出 `saving` / `failure` / `errors` / `dirty` / `reset` / `submit`。打开并填好初始值后调 `reset()`；提交写 `await submit(() => api…)`——保存中重复点击直接忽略，失败原因写进 `failure`，成功后 `dirty` 归零、关闭不再追问；字段错误由调用方在 `submit` 之前写进 `errors`。失败文案统一用 `@/utils/form`：`issueText`（zod issues 用「；」连成一句）、`failureText`（校验错误或 `apiError`），不再手写 `issues.map(…).join('；')`。

**表格与列表**

- `<table class="table-base">`：表头 surface-2 淡底、12px / 500 muted；单行行高约 44px，悬停 `bg-surface-2/40`；数字列在 th / td 上加 `text-right` 并用 `.num`（表格里自动不折行）；主字段 `text-ink font-medium`，副行 `.text-meta`；操作列靠右；选中行 `bg-primary-soft`；合计行放 `<tfoot>`（上方 line-strong 线、墨色加粗）。长品名单行截断并给 `title`。
- 操作列：一个 `secondary sm` 的下一步按钮 + `Menu`「…」收其余动作；纯图标的操作用 `.row-action`（28px，危险动作叠 `.row-action-danger`），平时淡、行悬停或聚焦时显出、触屏常亮 40px，必须有 `aria-label` 或 `title`。`td:has(.row-action)`、`td:has(.badge)` 已自动调好上下留白，操作列、状态列不要手写 `py-*`。
- 工具栏、表格、分页放在**同一个面板**里：`<Panel flush>`，工具栏放 `#toolbar`（就是 `flex flex-wrap items-center gap-2.5 px-4 py-3 border-b border-line`；搜索框固定最左、宽 300–340px，分段 Tabs 做筛选，右侧 `ml-auto` 放计数 / 排序 / 动作），表格贴边，Pagination 放 `#footer`（total 为 0 时自动不渲染，页脚整条隐藏）；不再单独做筛选卡片。筛选项多时收进「筛选」展开按钮（`pressed` 样式 + `aria-expanded`）。
- 多选时工具栏位置换成墨色批量条（`bg-panel text-white`，内部挂 `.dark` 让下拉和按钮用深色配色），不要另加一行。

```vue
<Panel flush>
  <template #toolbar>
    <SearchInput v-model="filters.search" class="w-full sm:w-80" placeholder="搜索物品名" @search="load" />
    <Tabs :model-value="tab" variant="segmented" :tabs="tabs" @change="switchTab" />
    <div class="ml-auto flex items-center gap-2"><!-- 计数、排序、右侧动作 --></div>
  </template>
  <div class="overflow-x-auto"><table class="table-base table-cards">…</table></div>
  <template #footer>
    <Pagination :page="filters.page" :page-size="pageSize" :total="total" @change="goPage" />
  </template>
</Panel>
```

- 非表格的列表（导入任务）用 `<ul class="divide-y divide-line">` 的行；行内动作是按钮或按钮样式的链接，窄屏时行内容换行、不横向溢出。

**面板与卡片**

- 一层容器：面板里不再套带描边的卡片；分组用留白、发丝线或 `bg-surface-2` 区块。
- `.card`（白底、发丝线、圆角，无阴影）是最基本的面板；带标题或页脚的面板用 `Panel`。要钉表头的表格面板不要加 `overflow-hidden`（§3）。
- 可折叠的次要内容（修改历史、识别依据、来源明细）用 `Disclosure`（§5.11），不手写 `<details>`。

**弹窗**

- 页脚按钮靠右：取消 = ghost，主动作 = primary（`accent` 是同样式的旧名字），危险 = danger（朱砂，只在确认弹窗里）；表单弹窗有未保存内容时传 `dirty`。
- 表单弹窗都给「取消」，用 `#footer` 的 `close` 渲染（`<template #footer="{ close }">`），它和 ×、遮罩、Esc 一样先过未保存确认；提交失败的原因放在页脚最左（§5.8）。
- 详情类信息用键值网格（手机两列、桌面三列），附件与历史等分区用 `border-t border-line pt-4` 隔开。

**加载、空与错误**

- 首次加载用 Skeleton 拼出形状；刷新时保留旧内容，不闪空。单个异步资源用 `useResource(fetch)`（`@/composables/useResource`，旧名 `useWorkflowResource` 仍可引用）：`loading` 只在还没有数据时为真（画骨架），`refreshing` 是已有数据时的再次加载（保留旧内容，给读屏一个 `role="status"`），`error` 是最近一次失败，过期响应自动丢弃；多个资源要分别降级（设置页）、或要追加分页（导入任务列表）时自己写。
- 接口一次返回全部数据的长列表（库存物品、成交价格）每次只画 50 条，底部「已显示 M · 共 N」+「显示更多（共 N …）」再追加 50 条；换筛选或重新查询时回到前 50 条。
- 空数据用 EmptyState（首次使用给两个入口；有筛选时 `icon=false`，复述「没有找到…」并给出清除条件的动作）；没有记录时不显示「第 0–0 条」和分页；请求失败用 ErrorState（原位重试，不跳页），或在局部给一行错误加重试（`Notice variant="inline" tone="red"`，「重试」是 `#actions` 里的 `link` 按钮）。
- 提醒与错误用 `Notice`（§5.11），不再手写 `bg-amber-soft` / `bg-red-soft` 的提示块和带 alert 图标的红字行。
- 异步列表用 `createRequestGuard()`（`@/utils/request`）丢弃过期响应；页面内切换对象（如导入任务）时，异步回调写状态前先核对对象是否仍是当前的。
- 业务写操作经 `mutate(method, url, body)`（`@/api/client`）带 `Idempotency-Key`：同一操作在重试、刷新后沿用同一个 key，成功后才从 sessionStorage 清掉。
- 金额、单价、数量的展示走 `components/workflow/presentation.ts`：`moneyLabel`（¥ + 千分位，小数位原样）、`unitPriceLabel`（「¥20 / 盒」）、`quantityLabel`（「6 盒」），不在模板里拼 `¥{{ … }} / {{ unit }}`。列表里的短时间用 `shortDateTime`（`@/utils/datetime`：今天只写时刻、昨天「昨天 HH:mm」、今年「MM-DD HH:mm」），完整时间放 `title`。

**Toast**

- 用于操作结果与后台事件（墨色浮层，错误是深朱砂底）；字段校验错误写在字段旁边。可以带一个动作（如「撤销」）；同时页面原位更新，不整页刷新。

## 7. 可访问性与操作

- 焦点：全局 `:focus-visible` 是 2px 朱砂外框（外扩 2px）；文本类输入控件（`.control`）是墨色描边 + 3px 淡环；不要去掉焦点样式。
- 原生语义优先：复选、单选、开关都是原生 input；Tabs 项是 `<button>`（当前项 `aria-pressed`）；按路由切换的导航（顶栏、设置子导航）是 `<nav>` 里的链接（当前页 `aria-current="page"`）。
- `aria-pressed` 只给开关按钮；展开器用 `aria-expanded`，两者不同时出现。
- 补充说明走 `description`（`aria-describedby`），不进可访问名称。
- 纯图标按钮必须有 `aria-label`（`.row-action` 可以用 `title`）；`Icon` 本身 `aria-hidden`。
- 键盘顺序跟随阅读顺序：导入页的 StickyActionBar 放在草稿之后、历史与上传区之前，Tab 顺序是「明细 → 保存 / 确认」。
- 触屏没有悬停：行内操作在触屏上常亮，不要让可操作的控件只在 `:hover` 时出现。
- 提示与错误区用 `role="alert"`；同一时刻不要出现多个意思重复的 alert（读屏会逐个打断播报）。
- 异步进度（上传中、保存草稿、识别状态、列表刷新）给读屏：常驻一个 sr-only `role="status"` 元素、只换里面的文字（元素和文字一起插入时有的读屏不播报）；文字没变时 DOM 不更新，轮询不会重复播报同一句。措辞按读屏的需要写；测试按 `data-testid` 读可见的状态文字，不靠措辞区分。
- 表格列头一律 `<th scope="col">`。
- `prefers-reduced-motion`：全局把过渡与动画缩到近 0（写在所有 `@layer` 之外，不需要 `!important`），页面不必另写。
- `forced-colors`（高对比度模式）：自绘复选框与单选框退回系统外观。
- 测试接口与定位约定：可见文案、可访问名称（label、`aria-label`、按钮名）、`role` 与 `data-*` 钩子是测试接口，改了就同步改测试（`apps/web/e2e`、`src/**/*.spec.ts`），不是不能改。测试优先用 `getByRole(role, { name })` / `getByLabel`；结构上按业务钩子（`data-request-id`、`data-document-id`、`data-product-id`、`data-request-line`、`data-command-line`、`data-receipt-line`、`data-purchase-line`、`data-task-id`）或 `data-testid` 找。不按 DOM 层级（`section` / `header` 祖先）、元素个数（title、链接计数）或样式类（`animate-pulse`）找——页面结构与样式不为测试让步。

## 8. 页面特例

- **登录**：桌面（≥ lg）左右两栏——左 5/12 是品牌面板（画布色，右侧一条发丝线）：方印 + 词标、墨线插画场景（`granary-scene`：瓦顶粮仓与门楣朱砂匾、谷穗、粮囤、远山与日轮）、一句定位与三条价值点（原件先存档 / 按量采购可追溯 / 库存与领用同一本账），整栏一层极淡的纸纹（`.paper-grain`）；右侧是表单面板（首帧 `animate-pop-in`），面板里的方印与词标在桌面上隐藏，避免重复。手机单栏：表单面板上方一幅 72px 的小粮仓（`granary`，高 < 700px 的矮屏不显示）。保留 `input[type=password]`、按钮文字「登 录」（测试按 `/^登\s*录$/` 找）、恢复码与初始化流程、页脚版本号。
- **工作台 `/workbench`**：页头说明写等待推进的申请张数（待办总数）。「待办概览」是一行数字：到货待处理在最前（大于 0 时数字朱砂）、待到货、待采购、未完成导入，最右库存物品（当前库存大于 0 的种数，0 不算库存）；各项链接到 `/requests?stage=…`、`/import`、`/stock`，手机上是通栏横向滑动的小卡。主体「待办申请」取后端待办的前 10 张（`pending: '1'`，后端按录入倒序），前端按下一步重排：有待处理 > 有待到货 > 仅待采购，同级按申请日期升序（`components/workflow/workbench.ts`）；每行是 `WorkbenchRequestRow`（流水号、部门 · 经办人、日期 · 明细数与状态 chip ｜ 各明细的剩余数量，待处理蓝色加粗、已办结绿色 ｜ 下一步按钮 + 一句原因：定去向 primary，登记到货 / 登记采购 secondary），按钮都进 `/requests/:id` 办理，工作台不直接登记；桌面三栏 200 / 1fr / 180，窄屏纵向堆叠、按钮整宽。待办清空时是一行提示「今天的待办都处理完了」，左边一幅 `rest` 小插画（合上的账、一盆绿植、一杯热茶）；从没有申请时给「人工录入申请」入口。页头 `#meta` 是日期 + 按时段的问候（`greetingLabel`：早上好 / 上午好 / 中午好 / 下午好 / 晚上好 / 夜深了）。右栏（< xl 排到主体下方）：`components/import/ImportPendingAside`（最近 5 份未入账的导入，「继续处理」进 `/import?task=…`，总数交给概览）与 `RecentDocumentsAside`（最近录入的 3 条业务记录，能对应到申请的链接到申请详情）。
- **申请单 `/requests`**：
  - 列表（`RequestCollection`）是一层 `Panel flush`：工具栏 = 搜索（流水号 / 品名 / 部门 / 经办人；接口不搜规格）+ 分段筛选「全部 · 有待采购 · 有待到货 · 有待处理 · 已办结」（地址参数 `stage`，工作台的待办数字链接到这里）+ 右侧「共 N 张 · 按录入时间倒序」（接口按录入顺序倒序）。表格 `table-fixed`，一张申请一行（`RequestRow`，`tr[data-request-id]`）：流水号（等宽，副行「N 条明细 · N 份原件」）| 部门 / 经办人 | 申请日期 | 申请明细（前两项单行截断带 title，「等 N 项」不参与截断；只有一条明细时副行写申请 / 已采购 / 已到货 …）| 进度 chips | 下一步 +「…」（查看申请详情、查看原件）。没有记录时不出分页；首次使用给「导入 OA 单」「人工录入申请」两个入口，搜索 / 筛选无结果复述条件并给「清除全部条件」「只清除关键词」。手机按 `.table-cards` 变卡片：流水号与明细在前，chips 与按钮在底部。
  - chips 与下一步由 `requestSummary.ts` 从后端的 `stages` 与数量推导：待处理（blue）、待到货（amber）在单位相同时合计数量（「待处理 4 包」），单位不同只数条数；待采购（gray）数条数；还有待办时已办结 / 已取消的明细只数条数，没有待办时是「实物已办结」（teal），全部取消是划线的「已取消」。下一步按 有待处理「定去向」> 有待到货「登记到货」> 有待采购「登记采购」，都进详情办理；没有待办是 ghost「查看」。
  - 人工录入（`RequestCreateDialog`，880px）：头部是 `RequestHeaderFields`（与「修改申请信息」共用）：「OA 流水号（等宽）/ 申请日期 / 申请部门 / 经办人」一行，流水号标签行右侧一个 sm 复选框「没有 OA 单号」（`data-auto-serial`；勾上后流水号框只读、占位「无OA-20261016-…」、框下「保存时自动编号；OA 单补下来后可以在申请详情补填」，取消勾选恢复刚才填的号）；部门、经办人是 `Combobox`（候选来自 `GET /workflow/directory`，打开弹窗时取一次）；经办人是以前出现过的人、部门空着时带出他最近一次的部门（框下 hint「按以往记录」，人工改了部门就不再动）；头部下面一行「最近」+ 24px 药丸「部门 · 经办人」（`data-recent`，可访问名称「填入最近的 …」，触屏 40px，两项都填了就不显示）；部门、经办人写法与已有的相近时框下一行 link「是不是「…」？」；流水号与别的申请相同时头部下方一行琥珀 inline Notice「已有申请用了这个流水号：…」+「查看」（新标签页，`data-duplicate-serial`），都不拦保存。说明「OA 审批单，或打过招呼、还没有 OA 单号的采购，都在这里录；采购和到货之后分别登记」。明细的品名、规格格是 `Combobox variant="cell"`（物品库的品名、这个品名用过的规格，`openOnClick=false`），品名（与规格）在物品库里只对应一个单位时单位格直接填上，格下 11.5px muted「沿用物品库」（`data-unit-source`），人工改过单位就不再动；单位格是带 datalist 的 `Input`（隐藏箭头）。明细是表格式输入，可访问名称带行号（「第 N 行品名 / 规格 / 申请数量 / 单位」、按钮「删除第 N 行」），另有「添加申请明细」「确认创建申请」。单位格回车跳到下一行的品名、最后一行回车加一行（输入法确认候选词的回车不算）；行级错误按行记（删行不会错位），字段只标 `aria-invalid`，原因在表下汇总「第 N 行：原因」；备注是单行「申请备注」。手机上每条明细一张小卡（单元格恢复描边、44px 高），弹窗全屏、页脚钉底。
- **申请详情 `/requests/:id`**：
  - 页头：`#meta` 是面包屑「申请单 / 流水号」；标题只有流水号（`mono`），状态 chip 放 `#status`（待处理 blue / 待到货 amber / 待采购 gray：单条明细写数量，多条写「N 项」；都没有时「实物已办结」teal，整张取消是删除线的「已取消」）；说明行「部门 · 经办人 · 申请日期 · 由 OA 原件导入 / 人工录入 · N 条明细」，还没有 OA 单号的写「人工录入，没有 OA 单号（补填）」（「补填」是 link，可访问名称「补填 OA 流水号」，打开「修改申请信息」并已取消勾选、聚焦流水号），补填过的写「人工录入 · 系统编号 无OA-…」（等宽）；动作依次「取消未采购量」ghost、「…」（secondary 图标按钮「更多申请操作」，`Menu` 里「修改申请信息」（`edit`）与朱砂「删除申请」）、刷新（secondary 图标）、「登记采购」primary。「修改申请信息」（`RequestEditDialog`，880px）：`RequestHeaderFields` + 单行「申请备注」，正文下方说明「申请日期是实际提出申请的那天，补办 OA 单不用改；已登记采购的申请，日期不能晚于第一次采购」（导入的申请再加一句「改的是申请，导入的识别与核对记录不变」），页脚左侧「修改会记入审计日志，留下原来的值」、「取消」「保存修改」；没改任何内容时保存直接关闭。「删除申请？」确认框：没有任何业务记录时说明删除范围（导入的申请写明导入会退回「待核对入账」），删除后导入的回到 `/import?task=…`、人工录入的回到 `/requests`；有业务记录时说明原因（含已撤销的单据，可用「取消未采购量」）并 `confirmDisabled`，与删除供应商同一做法。
  - 区块标题在面板外（15px / 600 + 13px 说明，标题到面板 10px，区块之间 28px）。从上到下：①「申请明细与数量进度」（`RequestProgress`，页脚是申请备注）②「已到货，待决定去向」（有到货待处理时出现，标题旁 blue chip「N 批」，`StockProductCard receiving` 单列排）③ 两栏 `lg:grid-cols-[minmax(0,1fr)_360px]`：左「业务记录」，右「OA 原件与附件」与「付款与开票」；`< lg` 单列。
  - 进度表首列品名、规格与单位下面是申请里附的采购链接：12px 蓝色文字链接，写网站名（「京东商品」「天猫商品」「淘宝链接」，其他网站是域名，`linkLabel`），后跟 12px `arrow-up-right`，悬停 `title` 是完整地址，新标签页打开；`editable`（申请详情）时后面是「更换链接」，没有链接的明细只在还有待采购数量时给「添加链接」，都打开 `LinkEditDialog`。
  - 进度表：第二列是四段进度条（已处理 = 直发 + 入库 teal / 待处理 blue / 待到货 `bg-amber/60` / 待采购 line-strong，段间 2px，按申请量折算，取消与退回的部分留空轨道）+ 一行说明，分段与页头 chip 的计算在 `lineProgress.ts`；条 `aria-hidden`，图例在区块标题右侧。其余数量列带 `data-label`（卡片里的列名，也是测试钩子），行带 `tr[data-request-line]`。≥ 640px 放不下时在自己的容器里横向滚动并钉住首列（真在滚动时首列右侧才有发丝线）；< 640px 走 `.table-cards`，进度条整行，数值为 0 的次要列（已采购、已到货、直发、累计入库、当前库存）用 `max-sm:hidden` 隐藏——只用 CSS，格子照样渲染，表格结构不随数值变；申请、待处理、尚待办理与进度条始终显示。
  - 业务记录（`DocumentCollection`，库存页「领用与归还」共用）：标题与类型筛选（`NativeSelect`，可访问名称「业务记录类型」）在面板外，面板里一条记录一行（`DocumentCard row`；不传 `row` 是「查看业务来源」弹窗里的独立卡片）。头行：类型 chip 与 #编号同在 `h3`（读作「采购成交 #117」）、日期、供应商或去向（直发 / 库存领用 · 部门）、已撤销（outline）/ 付款 / 开票 chip、右侧金额；动作行「登记到货」primary，其余 secondary，「撤销登记」ghost 靠右；`article[data-document-id]` 保留。未撤销的采购单，每条明细的小字行末尾有「商家链接」（有链接时）与「更换链接 / 添加链接」（`link` 事件 → `WorkflowActions.editLink`）。
  - `LinkEditDialog`（更换 / 添加采购链接，申请明细与采购明细共用）：标题「更换采购链接」或「添加采购链接」，说明是来源（「申请 OA-1 第 2 行」「采购成交 #117」）· 品名 · 规格；一个「采购链接」输入框（hint「清空后保存就是去掉链接」），精简后的地址与输入不同时下面一行「将保存为：…」，短链接时琥珀 inline 提示；分隔线下「原链接打不开？按品名搜同款：」+「去京东搜索」/「去淘宝搜索」（`linkSearches`：按原链接的网站，认不出时两个都给）。只改链接，审计日志记下旧值。
  - 右栏：「OA 原件与附件」是 `WorkflowAttachments sheet`（贴面板的文件行 + 顶部计数与「上传附件」）加一行说明与「查看原件识别与核对记录」；「付款与开票」（`RequestPayments`）列出本申请未撤销的采购单（编号 · 供应商、金额、付款与开票 chip），点整行打开「付款与发票」弹窗。
- **导入 `/import`**：
  - 页头右侧是识别服务状态（`components/import/ImportServiceStatus`，只读 `aiApi.config` 与 `systemApi.ocrHealth`，各自取回后才显示）：「AI 原件识别 已启用 / 未启用 / 未配置」（已启用的条件与服务端自动识别一致：启用 + 上传后自动识别 + 有 Key + 识别检测通过）、「本地 OCR 正常 / 不可用」，文字前一个小圆点（正常 teal、未启用与未配置 faint、不可用 red）。
  - 从上到下：步骤条（上传原件 → 识别单据 → 核对入账；当前步墨色实心数字、完成 teal 柔底对勾、识别失败琥珀提醒、未到描边数字，步骤之间 1px `line-strong` 线，手机只显示当前步骤名）、状态条（一张 sheet：文件名、「识别：…」「AI：…」、页数、「草稿已保存」（teal）、停止 / 重试）、页级核对复选框；桌面双栏（原件预览 : 草稿 = 5 : 7，`lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`），手机用「明细 / 原件」分段切换。单据头「流水号 / 申领部门 / 经办人 / 申请日期」两列，申领部门、经办人是 `Combobox`（识别出来的值不自动改），写法相近时 link「是不是「…」？」；流水号与已有申请相同时下方琥珀 inline Notice「已有申请用了这个流水号」（`data-duplicate-serial`）；经办人还有没补填 OA 流水号的申请时，单据头上方一块 sm 琥珀 Notice（`data-no-oa-hint`）：「{经办人}还有 N 张没有 OA 单号的申请：{编号链接}（品名等 N 项 · 日期）。如果这份 OA 单是给它补办的，打开那张申请补填流水号、上传这份原件，再「放弃草稿」，免得重复入账。」，不拦入账；未入账时取一次没补填的申请，换任务、撤回入账、回到这个标签页时重新取（`useDraftHeaderHints`）。草稿明细的表头只写一次（品名 / 数量 / 单位；面板窄时逐条堆叠，字段名改写在字段上方），行内 `Input size="sm"`，可访问名称带行号（「第 N 行品名 / 规格 / 采购链接 / 数量 / 单位」，`hide-label`），正在核对的明细 `bg-primary-soft`，「删除」是 `danger-ghost`（可访问名称「删除第 N 行」），识别依据与 AI 建议收在 `Disclosure` 里（另列「原件链接」原文）。品名列第三个输入框是采购链接（占位「采购链接（可空）」，离开时按 `canonicalLink` 精简；是完整地址时右侧一个 ghost 图标链接「打开第 N 行采购链接」，`arrow-up-right`，新标签页；不完整时字段下方红字，入账汇总里也拦）。单位为空时自动填（`useImportTask` 的 `fillUnit`：物品库里同名同规格、或同名只有一个单位 > AI 推测 `unitGuess`），输入框下方 11.5px muted 小字标来源「沿用物品库」/「AI 推测」（`data-unit-source`），人工改过单位就不再自动改、小字消失；单位框带 datalist（物品库单位、规格里的包装层级、常用单位），窄列里隐藏 datalist 箭头。行下的提示行可以有：琥珀 Badge「短链接容易失效，建议换成商品页地址。」；单位候选「单位可选 / 也可能是 / 物品库里是」+ 24px 药丸（触屏 40px，点了当作人工选择）。
  - 上传态（还没有任务，或地址里的任务已不存在）：步骤条下面两栏 `lg:grid-cols-[minmax(0,1fr)_400px]`——左边 FileDropzone 虚线框（撑高到 280px：标题「把 PDF、OA 截图或手机照片拖到这里」、限制说明、主按钮样式的「选择文件」提示，手机上框下另有「拍照上传」）、隐私说明（含「未确认的原件保留 30 天」）和「上传之后会发生什么」三小段；右边是「未完成的导入」。两栏外层只是排版容器，两块各自是有名字的区域。
  - 草稿区（`ImportDraftEditor` 的 fieldset）在草稿载入前（识别中）与已确认后整体只读：载入会整份替换单据头与明细，载入前的输入既不保存也会被覆盖。
  - StickyActionBar：「保存草稿」（secondary）「确认全部内容并导入」（primary），保存失败与其它错误放在 `#start`；还不能入账时 `#start` 另有一行琥珀 inline 汇总原因（`confirmBlockers`：单据头未填、明细品名 / 数量 / 单位未确认、页面未核对、AI 建议待核对、原件缺失，规则与 `workflowImportConfirmSchema` 及服务端确认一致），此时确认按钮禁用并经 `aria-describedby` 指向这行字（不是 alert）。「重新载入已保存版本」走页内 `ConfirmDialog`，放弃草稿失败的原因只显示在它自己的确认框里。没有阻塞项但有自动填的单位时，`#start` 是一行 12.5px muted「有 N 条明细的单位是自动填写的，请核对后再导入。」（不拦入账）。已入账的任务：申请还没有业务记录（`deletable`）时，原「放弃草稿」的位置是 `danger-ghost`「撤回入账」，走「撤回入账？」确认框（删除申请，任务退回待核对，草稿保留入账时的内容）。其后是修改历史与 AI 用量（历史只在展开时加载，草稿版本没变不重复请求，有加载中、失败重试与空态；AI 调用状态写中文，费用 `¥0.0123`），页尾仍是「上传区 | 未完成的导入」两栏（上传框不撑高、不显示三小段），方便导入下一份。确认成功后换成一张 sheet：40px 朱砂方印「入账」（−4°，`animate-stamp-in` 盖下来，180ms）+「已确认导入」+ 创建 / 合并 / 跳过 / 关联原件数 + ghost「撤回入账」+ 主按钮「继续办理申请」。
  - 「未完成的导入」（标题也是面板的区域名）：只按 `confirmedAt` 区分，分段 Tabs「未完成 / 已入账」，正在看「未完成」时标签后带朱砂计数；每行 = 状态图标（识别中蓝色转圈、待核对 `file`、识别失败琥珀 `alert`、已入账 teal `check-circle`）+ 文件名 +「时间 · 状态」（今天只写时刻、昨天写「昨天 HH:mm」，完整时间在 `title` 里；状态：识别中 / AI 原件识别中 / 识别失败，待人工核对（琥珀）/ 待核对入账（蓝）/ 已入账（teal），原件不在时追加「· 原件缺失」；未确认的任务不叫「已完成」）+ 右侧一个链接：待核对与识别失败是「继续处理」（secondary sm），识别中与已入账是「查看」（ghost sm）；每行 `li` 带 `data-task-id`；当前任务行 `aria-current="true"`、`bg-primary-soft` 并带「当前」Badge；页脚「共 N 条」或「已显示 N 条」，底部「显示更多（共 N 条）」追加下一页。状态判断、文案、图标与颜色集中在 `components/import/status.ts`（`isTaskActive`、`taskKind`、`taskStatusLabel`、`TASK_KIND_STYLES`），工作台的「未完成的导入」与识别步骤条、`useImportTask` 共用，不再各写一份 `PENDING || RUNNING`。
  - 当前任务只由地址里的 `task` 决定：切换前先保存草稿（保存失败就拦下并说明原因），切换时清空上一个任务的状态、丢弃迟到的响应，并把 `<main>` 滚回顶部。已确认的任务只读。
  - 重复上传相同内容的原件时，上传框下面出现一条 sheet：琥珀 chip「同一原件」+ 说明 +「打开已有任务」（primary sm）「这是新的业务，继续处理」「取消本次上传」。
  - 地址里的任务不存在时显示 `role="alert"` 的琥珀 `Notice`，不轮询、不自动新建任务。
- **设置 `/settings`**：
  - `SettingsLayout` 给出页头「设置」与子导航 `<nav aria-label="设置分区">`：桌面左侧 200px、滚动时钉在 `<main>` 顶部，当前项 surface 底 + 左侧 2px 朱砂 + 墨色 600；< lg 变成横向滚动的药丸行。右侧内容最宽 760px。「系统」一组是 `/settings` 各区块的锚点（外观、账号安全、系统状态、AI 助手、自动备份、备份管理，id 即地址里的 `#hash`，见 `components/settings/sections.ts`），当前项跟着 `<main>` 的滚动位置走（`aria-current="true"`），带 `#hash` 打开时载入后定位到区块；「主数据与记录」是供应商与比价 `/settings/suppliers`、审计日志 `/settings/audit` 两个子页（`aria-current="page"`）。
  - 每个区块一个 `Panel flush`：标题行 + 设置行（`components/settings/SettingRow.vue`：左 13.5px / 500 label + 12.5px muted 说明，右边控件，行间 `divide-y divide-line`）；开关行直接用 `Switch`（`label-position="left"`，说明走 `description`，用 `[&_.text-meta]:` 调成 12.5px muted）。除「外观」外各区块是 `components/settings/` 下的一个组件（`AccountSecurityPanel`、`SystemStatusPanel`、`AiSettingsPanel`、`AutoBackupPanel`、`BackupManagerPanel`）；`SettingsView` 只加载系统状态、备份列表、OCR 健康与 AI 配置（四个请求并行）并按顺序编排，初始值经 props 交给面板，备份列表用 `v-model:backups` 与 `v-model:error`。系统状态失败是整页 `ErrorState`；备份列表、AI 配置读取失败只在各自区块显示 inline 红字 +「重试」，不显示假空态。系统状态面板的「刷新」只重拉系统状态与 OCR 健康（按钮转圈），不回填其它面板的表单。
  - 账号安全：修改密码、重置恢复码各在弹窗里；退出登录只在顶栏账号菜单与手机「更多」里。系统状态：标题说明是版本与运行时长；四格数字（申请单 / 物品 / 有效单据（已过账）/ 数据库）；两行状态：库存核对（接口返回时才显示：正常 = teal、N 处不一致 = red、尚未核对 = gray Badge，后跟核对时间）与本地 OCR 服务（不可用时下方琥珀提示）。备份管理行内只有「下载」，恢复与删除收在「…」里并各走确认框；恢复进行中是 persistent 的「正在恢复备份」弹窗（`role="status"` 的进度文字），焦点圈在弹窗里，键盘也碰不到页面上的按钮。AI 区的连接默认收起（「服务已配置 · 修改连接」），服务器配置了 Key 时不显示 Key 输入框。
  - 供应商与比价：查询实际成交价格，明确展示规格、单位和来源申请；还没有供应商时空态配 `shop` 插画；不以旧的品名报价表为新采购提供建议。工具栏左侧是供应商搜索（名称、联系人、电话、备注，前端过滤，地址参数 `supplierSearch`），计数写「找到 N 家 · 共 M 家」，无结果时复述关键词并给「清除关键词」；成交价格表每次画 50 条、底部「显示更多」。行内「编辑」+「…」（删除）；已有单据的供应商在删除确认框里说明「已有 N 份单据，不能删除」并禁用确认按钮（`confirmDisabled`）。成交价格首次查询用骨架，之后再查询保留旧表格、工具栏显示「查询中…」；搜索无结果时复述关键词并给「清除关键词」。审计日志：操作类型 chip 只用 gray / amber（覆盖或回退数据：恢复备份、改密、撤销登记…）/ red（失败、删除、库存核对不一致），业务登记（`WORKFLOW_*`）显示中文名；整行可点展开详情，键盘与读屏用详情格里的展开按钮（`aria-expanded`）。
- **统计报表 `/insights`**：
  - 筛选一行：期间分段（全部 / 本月 / 上月 / 本季度 / 自定义：快捷期间按本地日历写入整月 / 整季的起止日期并立即查询；按当前填的日期认出对应的快捷期间；「自定义」把焦点交给起始日期）+「起始日期」「结束日期」+ 金额分组 +「查询报表」。
  - 核心指标是一张面板：左边净成交金额（34px / 700）与公式行（成交原额 − 采购取消 − 退款退货，换货保留成交金额），右边四个小指标：采购单数（各分组 `purchaseCount` 之和，按部门分组时跨部门的单据各计一次）、到货原额、净到货金额、实物退货金额。
  - 「采购金额」面板（分组方式与区间写在说明里，标题只写这四个字）：第一列名跟着分组方式走；净成交列是单色 `bg-blue` 细条（8px、右端圆角，按本表最大净成交取比例，0 与负数不画）+ 靠右的加粗数字；`tfoot` 合计。「员工领用」同样式。两张表右上各有「导出 CSV」（secondary sm），都是 `table-base table-cards`：≥ 640px 在自己的容器横向滚动，不能撑宽整个页面；< 640px 按 §4 变成卡片（条形与合计行在卡片里不显示，合计见核心指标）。
  - 金额 ¥ 前缀 + 千分位（负号在 ¥ 之后：¥-0.34）。没有数据时用无结果样式的 EmptyState（有区间时给「查看全部时间」）；从没有成交记录时「采购金额」的空态配 `report` 插画。查询失败的原因是页面上唯一的 `role="alert"`。旧地址 `/reports` 重定向到这里。
- **库存与领用 `/stock`**：
  - 页头：「刷新库存」图标按钮 +「新增库存物品」（secondary）。underline 页签：库存物品 N / 到货待处理 N / 领用与归还 / 库存流水；库存为 0 的不算库存，「库存物品 N」数的是当前库存大于 0 的种数（与工作台的「N 种库存物品」同一口径，服务端 `stockProductCount`）；计数跟着当前搜索，并入按钮的可访问名称（测试按 `/^库存物品( \d+)?$/` 找页签）。
  - 库存物品、到货待处理是同一个 `Panel flush`（接口一次返回全部物品，列表每次画 50 种，超过时页脚「已显示 M 种 · 共 N 种」+「显示更多」）：工具栏 = 搜索「搜索品名或规格」+（只在库存物品页签）分段筛选「有库存 N · 已空 N · 全部 N」（`Tabs variant="segmented"`，可访问名称「库存筛选」，地址里 `stock=in|empty|all`，默认 `in`，认不出的值按默认；规则在 `components/workflow/stockFilter.ts`：有库存 = 当前库存大于 0；已空 = 库存为 0、入过库、也没有到货待处理；全部 = 物品库里的每一种，含申请带进来还没入过库的）+ 右侧「按品名排序 · 共 N 种」（刷新时「刷新中…」）。到货待处理页签不用这个筛选，列出全部有待处理数量的物品。空态：首次使用（新增库存物品 / 查看申请单）；物品库里有物品但没有一件有库存时 `shelf` 插画「现在没有库存」+ 说明 0 不算库存、物品库的 N 种在「全部」里 +「看全部物品」「新增库存物品」；到货待处理已清空（一行提示）；搜索或筛选无结果（复述条件；在有库存 / 已空里搜不到时给「在全部物品里找」「清除关键词」）。「新增库存物品」保存后切到「全部」并按品名搜出这件物品，Toast 提示用「盘点调整」录入现有数量。
  - 行式列表 `StockProductCard layout="row"`：列宽由列表容器的 `--stock-cols` 给，表头行与每一行共用（展开 | 物品 | 单位 | 主数量 | 次数量 | 来源 | 操作）；到货待处理页签把待处理数量（蓝）换到主数量列。单位单独一列，数量里的单位只留给读屏；库存为 0 是 amber「已空」，从没入过库的物品来源列写「还没入过库」；行内动作全部可见（库存领用 / 直接发放 / 登记入库 / 退回供应商 = secondary sm，盘点调整 = ghost sm）；首列展开按钮（可访问名称「采购来源与数量」，`aria-expanded`）列出来源批次（供应商 · 单价、库存、待处理、来源明细 / 到货明细 / 申请）。≥ 640px 放不下时在面板里横向滚动，< 640px 每行堆叠成卡片（列名在左、值在右，展开按钮在右上，动作在底部换行）。
  - `StockProductCard` 默认 `layout="card"`：申请详情「已到货，待决定去向」一物一张卡片（品名 + 规格 / 来源 | 待处理 | 直接发放 primary + 登记入库 / 退回供应商），外面不再套面板。根元素 `article[data-product-id]`、品名 `h3`，主数量带 `data-testid="product-quantity"`（读出来是「8 盒」）。
  - 领用与归还沿用 `DocumentCollection`；库存流水是 `table-cards` 表格：日期 | 物品 | 业务类型（冲销加 outline chip）| 位置 | 数量变化（增加 teal、减少 red）| 来源（业务 # / 来源明细 #）。
  - 各物品单位不同，库存数量不相加。供应商与审计保留「工具栏 + 表格或行列表 + 分页」的一层面板。
- **登记类弹窗（`components/workflow/`）**：
  - 宽度：登记采购 880；登记到货与 `QuantityCommandDialog`（入库 / 发放 / 退回 / 取消）760；盘点调整、付款与发票、新增库存物品 560；撤销业务登记是 420 的确认框排版（`Dialog compact`、手机不全屏、朱砂确认按钮，保留「撤销日期」「撤销原因」，失败原因放在正文的红色 `Notice` 里）。页脚左侧是失败原因（`role="alert"`）或一句提示，右侧「取消」+ 主按钮（名字不变：登记已下单、确认本次到货、确认{动作}、确认盘点调整…）；手机上页脚钉底、主按钮整宽 44px。
  - 明细是表格式明细，统一用同目录的 `RegisterLineTable` 与 `useRegisterLines`（已选行数、表下的行级错误汇总、全选，三个弹窗共用）：列头只写一次，第一列是选择框 + 品名 + 规格 / 来源 meta（表头这一格是「全选」，部分勾选时半选；手机上「全选」换到表格上方），其余列是待采购 / 尚欠 / 可操作（数字右对齐）与本次数量，采购再加成交单价、本行金额，发放再加领用人。行内 `Input size="sm" hide-label`、输入框后跟单位；可访问名称保留全称（「{品名} 本次数量（{单位}）」「{品名} 领用人」「{品名} 本次采购数量（{单位}）」「{品名} 成交单价（元/{单位}）」「{品名} 采购链接」「{品名} 本次到货数量（{单位}）」），复选框名就是品名。未勾选的行变淡、输入格显示「—」。字段错误只在单元格标红框，原因在表下汇总「第 N 行 · 品名：原因」。手机上每行一张卡片（`.table-cards`）。表头在弹窗正文里钉住（包一层 `[--main-pt:1.25rem]` 抵掉正文上内边距）。
  - 登记采购：一条明细一个 `<tbody>`，主行下方一行放历史成交价小药丸（悬停蓝色；点了填入单价与链接并选定该供应商，别家的随即禁用）与采购链接；链接框默认填申请里的链接，相同时下方一行 12px muted「来自申请（OA 原件上的链接）」，改选别的供应商清掉历史价时链接退回申请链接；是完整地址时框后一个 ghost 图标链接「打开 {品名} 的采购链接」；短链接时琥珀小字提示；不完整的链接在单元格标红并进表下汇总；合计在页脚左侧（「本次成交合计 ¥…」或「已填价合计 ¥… · N 条价格待填」，金额加千分位）。发放：头部「业务日期 / 领用部门 / 领用人」一行（`sm:grid-cols-3`），领用部门、领用人是 `Combobox`；「领用人」填一次各行跟着填，某一行单独改过就不再跟着变（hint「填一次，下面各行都用这个人」），从申请直接发放时默认是申请的经办人（hint「默认是申请的经办人，可以改」），库存领用不预填；选了以前的领用人（头部，或头部空着时行里的）、部门空着时带出部门（hint「按以往记录」）；每行的领用人也是 `Combobox size="sm"`（可访问名称「{品名} 领用人」不变）。「拆给另一位领用人」在品名下方，拆出的行紧跟在同一来源之后、领用人空着。退货处理方式是分段 Tabs。盘点调整的「调整后库存」在页脚左侧，负数标红。数量类弹窗的行带 `tr[data-command-line]`（另有 `tr[data-receipt-line]`、`tbody[data-purchase-line]`），是测试钩子。

## 9. 修改守则与验证

不做的事：

- 颜色只用令牌（`text-muted`、`bg-surface`、`border-line`、`text-accent` …）；不用 Tailwind 调色板颜色（`text-red-600`、`bg-blue-50` …），不写内联颜色，不用 `!important`。
- 不引入新的运行时依赖（UI 库、图标库、字体文件、Google Fonts）；缺的图标在 `Icon.vue` 里补。
- 视觉改动不顺带改业务逻辑、API 调用、store 和路由；改了用户可见文案、`aria-*`、`role`、按钮名或 `data-*` 钩子，同步改测试并在提交说明里写清（§7 定位约定）。
- 先用 §5 的组件和 §6 的全局类，不新建与现有组件重复的基元；确需新增时写进本文。
- 不在页面里重复外壳的职责（导入 / AI / 主题 / 退出入口、`<main>` 的留白、给底栏让位）。

验证：

```bash
pnpm --filter @canglin/shared build     # 改了 packages/shared 时先构建
pnpm --filter @canglin/web typecheck
pnpm --filter @canglin/web lint
pnpm --filter @canglin/web test
pnpm --filter @canglin/web build
pnpm --filter @canglin/server build     # e2e 前先构建 API（原因见 README「测试」）
pnpm --filter @canglin/web test:e2e
apps/web/scripts/visual.sh               # 视觉回归：在 Playwright 容器里跑（有意改了 UI 后加 --update）
```

- `e2e/visual.spec.ts` 把下面的截图矩阵（1440 / 390 × 浅 / 深色，主要页面与三个登记弹窗）做成了 `toHaveScreenshot` 基线：浏览器时钟固定、服务端时间与会变的数字用 mask 盖住；在固定的 Playwright 容器里运行（`scripts/visual.sh`，CI 的 visual job 用同一个镜像，见 README「测试」）。有意改了 UI 后用 `scripts/visual.sh --update` 重建，并人工看一遍差异图。

截图检查（浅 / 深色 × 1440 / 390 宽）：

- 没有原生控件外观穿帮（复选、日期、文件框、下拉），没有卡片套卡片，深色下面板边界可辨、实心按钮文字可读；
- 390px 下没有横向滚动，表格按 §4 变成卡片；
- 底部标签栏、StickyActionBar、Toast 不挡住可操作的控件，滚到页尾能点到最后一个按钮；
- 无头浏览器截图只是模拟，安全区、软键盘、iOS Safari 等仍需真机确认。
