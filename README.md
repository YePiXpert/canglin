# 仓廪

供一位行政采购管理员使用的采购与领用系统：OA 已审批单导入或人工录入 → 分次采购 → 部分到货 → 按量直发或明确入库 → 库存领用。支持集中采购、分次付款与退款、员工垫付及报销、发票金额匹配、扫码作业、异常处理和月度复盘。原名 Procure Lite，2026-10-10 改名并发布 v2.0.0。

当前开发版本为 **1.0.0-beta.2**（本地实现，尚未发布）：新增集中采购、资金与发票金额对账、手机扫码、异常/月报和 AI 操作草稿。已发布并部署的版本仍为 **1.0.0-beta.1**。版本命名按本次 Beta 交付要求采用新的 1.0 系列，历史 v2.x 标签保留；升级以明确的 Git tag / 提交和镜像摘要为准。

确认的产品范围见 [重构需求](docs/rebuild-requirements.md)；Beta 2 的使用、金额口径、升级与验收见 [采购执行与结算说明](docs/execution-settlement-2026-10.md)，上一版发布见 [Beta 1 交付记录](docs/release-1.0.0-beta.1.md)。部署维护见 [升级说明](docs/upgrade-2026-09.md)，前端规范见 [设计规范](apps/web/DESIGN.md)。

## 适用范围

- 单管理员、单机 Docker 部署，OA 已完成审批（打过招呼先采购、还没有 OA 单号的也能录，系统编号，OA 单补下来后补填），本系统负责采购执行、实物流向和可追溯记录。
- 同一申请明细允许多次采购、不同供应商和成交价；申请、采购、收货、发放与退回分别记账。
- 按实际金额记录分次/合并付款、退款、员工垫付、报销和员工退回；发票独立按金额匹配。不连接银行、不发起真实转账、不进行税务开票。历史付款标记只作参考，显式核对期初后才进入金额账。
- 物品按“品名 + 规格 + 单位”区分；不做自动单位换算、复杂仓库批次成本、多用户审批、预算与合同管理。

## 架构

```
┌──────────┐   /api    ┌──────────┐  HTTP(内网Key) ┌──────────────┐
│  nginx   │ ────────▶ │  NestJS  │ ─────────────▶ │ Python OCR   │
│ 静态前端  │           │ Prisma + │                │ PaddleOCR    │
│ (Vue 3)  │           │ SQLite   │  HTTPS(可配置) │ pdfplumber   │
└──────────┘           └────┬─────┘  ────────────▶ └──────────────┘
                            │ state/ (db·uploads·backups·secret)  LLM API
                                                                (GPT / Responses)
```

- **apps/web** — Vue 3.5 + Vite + TypeScript + Tailwind v4 + Reka UI（自建组件）+ PWA；设计令牌、组件用法与页面约束见 [apps/web/DESIGN.md](apps/web/DESIGN.md)
- **apps/server** — NestJS 11 + Fastify + Prisma(SQLite) + argon2 认证 + 审计日志 + 备份恢复
- **apps/ocr** — FastAPI + PaddleOCR：文本层 PDF 按表格边框重建行列、栅格化 OCR 兜底、OA 界面噪音过滤、页图预处理
- **packages/shared** — zod API 契约与状态枚举（前后端共享）

## 核心流程

1. **导入或录入申请**：上传 PDF、OA 截图或手机照片。已配置且能力检测合格时，AI 直接识别原件；失败页回退本地 OCR，始终由人工核对后确认。未知数量、日期保留空白，同名的原始明细保留独立行。原件没写单位时，草稿按物品库里同名物品的单位直接填上，物品库对不上再用 AI 推测的单位，都标出来源、可以改；原件备注里的商城链接随明细入账（精简掉跟踪参数）。也可直接人工录入申请：没有 OA 单号时勾选「没有 OA 单号」，系统编「无OA-申请日期-序号」，OA 单补下来后在申请详情「补填」（原编号仍能搜到）；部门、经办人、领用人和品名都能从用过的写法里下拉选（也能手填），选了经办人自动带出部门，写法相近时提示。申请的流水号、日期、部门、经办人和备注录错了可以「修改申请信息」，审计留旧值。
2. **按量采购和收货**：在申请详情填写本次供应商、数量和成交价，链接框默认填申请里的链接，可以直接打开去下单。一条申请可以一部分待采购、一部分待到货或待处理；每次到货只登记实际收到的数量。
3. **明确物品去向**：已收货物品可以部分直发；剩余量仍待处理，选择入库才进入库存。库存领用形成新的发放单，保留领用人、部门和来源。发放时领用人填一次各行跟着填，从申请直接发放默认发给申请的经办人（可改）。
4. **退回与纠错**：供应商退款退货减少净成交额，换货保留成交并等待补货；员工归还进入库存，再次领取记为新领用。错录通过撤销单据追加反向流水；有下游使用时须先撤销依赖记录，历史不删除。还没有任何业务记录（含已撤销的单据）的申请可以删除；导入的申请删除后，导入退回待核对，改好后重新入账。申请与采购单上的链接失效时可以更换，审计日志记下旧链接。
5. **财务与报表**：资金对账登记实际付款、退款及垫付报销，发票池保留原件并支持一票多单、多票一单和冲减。新采购的付款/发票状态由有效明细计算；旧标记不会自动生成付款。月度复盘区分采购、现金往来、供应商交付和净领用，支持导出和打印。

6. **盘点与补货**：库存盘点保留账面快照与实盘差异；期间出入库后必须重盘。补货按安全库存与目标计算，扣除已有库存补货申请和草稿，确认草稿后继续采购与入库。
7. **采购跟进**：按明细跟进到货、按采购单跟进发票；日期和记录可批量设置，收货、换货、撤销与附件变化自动影响完成状态。提醒只在站内显示。
8. **集中采购与手机作业**：跨申请需求汇成采购批次，拆供应商后一次确认；扫码或选取物品/单据，保存到货、入库、直发和库存领用草稿，核对后执行。执行后可附到货照片或签收凭证。
9. **异常与 AI 草稿**：异常中心展示实际业务差异，可暂缓、忽略和恢复并保留原因。AI 只准备采购批次或发票匹配建议，保留原建议、解释和人工修改；来源变化后须重新核对。

主导航为工作台、申请单、库存与领用、报表、系统设置。工作台和导入页都能找回未完成草稿；草稿保存带版本号，过期版本拒绝覆盖。导入页可放弃未入账草稿：确认后停止识别并删除该任务与原件，之后可重新上传。已确认任务只读且关联原件，重复提交不会重复入账；申请还没有业务记录时可以「撤回入账」（删除申请，任务退回待核对）。

数量最多六位小数、单价最多四位小数、人民币金额两位小数；新业务以整数定点数计算，行金额四舍五入后汇总。旧测试台账及其兼容页面、接口已在 2026-10-08 的迁移中删除（旧数据按需求视为测试数据，不转换为采购事实），主流程从新申请开始。

## AI 能力（可选）

在系统设置连接支持 Responses API 的服务，保存地址、密钥与模型并完成能力检测。模型默认只提供 `gemini-3.8-flash-high`、`gpt-6.1-sol`（中等思考）与 `grok-4.7`，可用服务器环境变量 `LLM_ALLOWED_MODELS` 换成别的列表（逗号分隔，`*` 不限制）。图像和结构化输出通过后，可开启自动智能导入；识别、问答共用一个模型。

- **原件识别**：带文本层的 OA 打印 PDF 先按表格边框重建物理行（不经 OCR），AI 在审核模式下只拆分品名与规格、判断单位（原件没写单位时另给一个推测单位，只用来填草稿），数量与链接以文本层为准；截图、照片和扫描页由 AI 在识别模式下从页图主识别（照片先转正、缩放）。失败页由网格结果或本地 OCR 补充，两者都失败时仍可人工补录并记录逐页核对。AI 不伪造坐标，不自动入账；与已有物品匹配的品名只作建议，由你决定是否采用。
- **人工差异确认**：重试产生的品名、规格、单位、数量和价格变化须明确处理，后台迟到结果不会覆盖人工草稿。
- **只读问答**：AI 助手查询申请、业务单据、库存、供应商、资金对账、异常、需求池和月报，回答附查询轨迹和业务链接。
- **操作建议与发票识别**：在集中采购或发票页面点击 AI 生成可编辑草稿，明确确认后才执行；发票 PDF 文本提取或 AI 逐页图像识别仅预填票面，核对原件后再确认。

密钥优先使用服务器的 `LLM_API_KEY_FILE` 或 `LLM_API_KEY`，否则使用设置页保存的密钥；页面和日志不返回明文。配置方式见 [第三方 Responses](docs/upgrade-2026-09.md#配置第三方-responses)。未启用 AI 时，可使用本地 OCR 和人工录入。

## 本地开发

```bash
corepack enable && pnpm install
pnpm --filter @canglin/shared build

# 终端 1：OCR 服务（首次需 pip install -e "apps/ocr[paddle]"，或跳过仅做轻依赖测试）
cd apps/ocr && python -m venv .venv && . .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e ".[dev]"           # 轻依赖（解析逻辑可测，不含 paddle）
pip install -e ".[paddle]"        # 完整 OCR 能力（较重）
uvicorn app.main:app --port 8000

# 终端 2：API + 前端（API 默认把数据放在 apps/server/state/；迁移命令需要指向同一个数据库文件）
export DATABASE_URL="file:$PWD/apps/server/state/canglin.db"
pnpm db:migrate                   # 初始化开发数据库
pnpm dev                          # API :3000 + Vite :5173（自动代理 /api）
```

访问 http://localhost:5173，首次进入设置管理员密码。

iOS 主屏图标与 PWA 的 maskable 图标（`apps/web/public/apple-touch-icon.png`、`apps/web/public/icons/icon-maskable-512.png`）由脚本生成，改了品牌图形后重新运行 `node apps/web/scripts/render-icons.mjs`（用 Playwright 的 Chromium 渲染 SVG，首次需 `pnpm --filter @canglin/web exec playwright install chromium`）。

## 测试

```bash
pnpm --filter @canglin/shared build            # 前后端测试都依赖 shared 的构建产物
pnpm test                                           # 前端单测 + 服务端测试（vitest）
pnpm --filter @canglin/server build            # 浏览器测试的 API（apps/server/test/browser-server.cjs）加载 dist
pnpm --filter @canglin/web exec playwright install --with-deps chromium   # 首次运行浏览器测试前
pnpm --filter @canglin/web test:e2e            # 浏览器流程：临时 SQLite + 真实 API，OCR/GPT 为合成替身
apps/web/scripts/visual.sh                          # 视觉回归（在 Playwright 容器里跑，需要 docker，见下）
python3 -m unittest discover -s deploy/tests -v     # 部署脚本（伪 git/docker，不接触真实服务）
python3 -m unittest discover -s scripts/tests -v    # 导入评测脚本
(cd apps/ocr && pytest)                             # 解析器单测 + API 集成（无需 paddle）
```

视觉回归 `apps/web/e2e/visual.spec.ts`（1440 / 390 × 浅 / 深色，主要页面与三个登记弹窗）是 Playwright 的 `visual` 组（`test:visual`），和浏览器流程（`test:e2e`）分开跑、各用一个全新的临时库。截图基线（`e2e/visual.spec.ts-snapshots/`）只在固定的容器里生成和比较：`apps/web/scripts/visual.sh` 用 `mcr.microsoft.com/playwright` 官方镜像（版本跟 `pnpm-lock.yaml` 里的 `@playwright/test` 一致，另装 `fonts-noto-cjk`，中文标题有真正的粗体），把仓库（含未提交的改动）复制进容器安装、构建再比较，不动本机的 `node_modules`；失败时差异图在 `apps/web/test-results/visual/`。CI 的 `visual` job 用同一个镜像，通过后才发布镜像。有意改了 UI 后运行 `apps/web/scripts/visual.sh --update` 重建变化了的基线，人工看一遍差异再提交；升级 Playwright 时同时改 CI 里的镜像标签并重建基线。

## Docker 部署（VPS）

每次 push 到 `main`，GitHub Actions 会自动跑完全部测试后把三个镜像构建并推送到 GHCR（`ghcr.io/yepixpert/canglin-{web,server,ocr}`），**VPS 上不需要编译**，直接拉镜像。

> GHCR 包默认私有。首次发布后到 GitHub → 你的 Packages → 各镜像 → Settings → Change visibility 改为 **Public**（公开仓库无敏感信息）；或保持私有并在 VPS 上 `docker login ghcr.io`（PAT 勾选 `read:packages`）。

**首次部署**（服务器上装好 git 与 docker，并以 root 或具有目标目录写权限的用户运行）：

```bash
curl -fsSL https://raw.githubusercontent.com/YePiXpert/canglin/main/deploy/deploy.sh | bash
# 自定义端口：同一命令末尾改为 bash -s -- 9000
# 自定义目录：同一命令末尾改为 bash -s -- 8080 /srv/canglin
# 不用 GHCR 镜像、在本机构建：末尾加 --build，如 bash -s -- --build 或 bash -s -- 8080 /srv/canglin --build
```

默认部署目录为 `/opt/canglin`，不存在时自动克隆；已有仓库和 `.env` 会复用。源码开发副本可放在 `/workspace/canglin`，不会被脚本自动选为部署目标。目录优先级为显式参数 → `CANGLIN_REPO` → `/opt/canglin`。

脚本自动完成：生成 `.env`（随机 OCR_API_KEY）→ 从 GHCR 拉取当前提交（`sha-xxxxxxx`）的镜像并启动 → API 与 OCR 就绪检查。首次访问 `http://<服务器IP>:8080` 设置管理员密码。拉不到镜像时脚本报错退出，不会自动改用本地构建：多半是这个提交的 CI 还没跑完或没通过（到 GitHub Actions 查看，通过后重新运行），或私有包还没 `docker login ghcr.io`；确认要用本机源码（未经 CI 测试）构建时加 `--build`。

**版本升级**（一行命令，任意目录执行；默认操作 `/opt/canglin`）：

```bash
curl -fsSL https://raw.githubusercontent.com/YePiXpert/canglin/main/deploy/upgrade.sh | bash
```

自定义部署在其他位置时，必须显式指定目录（`CANGLIN_REPO` 环境变量也行）。即使从开发仓库运行脚本，默认目标仍是 `/opt/canglin`：

```bash
curl -fsSL https://raw.githubusercontent.com/YePiXpert/canglin/main/deploy/upgrade.sh | bash -s -- /path/to/canglin
bash deploy/upgrade.sh --build     # 不等 CI，直接用本机源码构建全部三个镜像（未经 CI 测试）
bash deploy/upgrade.sh --no-pull   # 不拉取代码，按当前源码 SHA 拉取镜像（同时加 --build 则本地构建）
```

数据统一保存在部署目录的 `data/`（默认 `/opt/canglin/data`），`canglin_state` 仅作为映射该目录的 Docker 卷名。首次部署脚本会准备目录权限；旧版升级会在停机备份后自动迁移并核对数据，保留独立旧卷副本。不要直接用 `docker compose up` 代替旧版首次升级。自定义部署目录由脚本写入 `.env` 的 `CANGLIN_DATA_DIR`。

升级脚本只做快进更新（已跟踪文件有本机改动时退出），三个服务绑定同一源码的 `sha-xxxxxxx` 标签并写入 `.env` 的 `RELEASE_TAG`；新镜像就绪后才停机，停机后先把整个数据卷和三个旧镜像引用保存到 `pre-upgrade-backups/release-TIMESTAMP/` 再启动新版本。拉不到这个标签的镜像时（CI 还没跑完或没通过、私有包没有 `docker login ghcr.io`）脚本在停机前报错退出：源码退回升级前的提交、不留下这次的回退点，也不会回退本地构建；确认要用本机源码时加 `--build`。这些回退点不会自动删除，稳定后由管理员归档；回退必须同时恢复旧数据和旧镜像，回退与回退后的管理命令见 [升级说明](docs/upgrade-2026-09.md#备份恢复与回退)。推送源码和发布 GHCR 镜像不会自动更新 VPS。

## 数据与安全提醒

- **数据在哪**：Docker 部署的全部状态在 `canglin_state` 卷里（本地开发默认是 API 运行目录下的 `state/`，即 `apps/server/state/`，可用 `DATA_DIR` 指定）：`canglin.db`（SQLite）、`uploads/`（单据原件与附件）、`backups/`（系统设置里生成的备份）、`session-secret`（会话签名密钥）。
- **什么会离开本机**：启用 AI 后，问答的问题、近几轮对话与只读查询结果，智能搜索的搜索词和库内品名词表，以及开启自动识别的单据每页原件图像、本页文本层与解析结果、物品目录（品名、规格、单位，最多 300 条），会发送给所配置的服务商（服务商侧的留存说明见 [升级说明](docs/upgrade-2026-09.md#配置第三方-responses)）。Beta 2 中，主动生成操作草稿还会发送整理要求和所选申请/采购/发票的业务字段、金额与来源；发票 AI 识别会发送所选页图。二维码在浏览器本地解码，不上传给识别服务；执行后上传的照片和凭证保存在本机附件目录。不启用 AI 时不向模型服务发送这些数据。
- **备份**：系统设置里的备份包含数据库与 `uploads/`（附清单和逐文件哈希），不含 `.env`、`session-secret` 和外部 secret；备份就放在同一个数据卷里，请下载后异地保存。自动备份默认关闭。
- **恢复**会覆盖当前数据库与附件，恢复前先创建一份备份；恢复后现有登录会话失效。升级回退点见上文「版本升级」。
- 未确认入账的导入原件保留 30 天后自动清理（撤回入账的从撤回时算起）；已确认的原件作为申请附件长期保留。
- `.env`、`secrets/`、`docker-compose.override.yml`、`state/`、`pre-upgrade-backups/` 已在 `.gitignore` 中；密钥文件放在部署目录的 `secrets/`（或外部 `/etc/canglin/`），不要提交到仓库，也不要放进 `uploads/`。

## 安全模型

- 单管理员，argon2id 密码哈希，登录失败 5 次锁定 15 分钟
- HttpOnly + SameSite=Strict 签名 Cookie 会话（30 分钟滑动过期），恢复码重置密码
- 所有 `/api/*` 经全局守卫鉴权；OCR 服务仅内网通信且校验 API Key
- 上传类型/大小白名单，备份恢复含 zip-slip 与解压限额防护

## 开发约定

- 改动前先对照上面的「适用范围与不做什么」；超出范围的需求先讨论，不顺手加。
- 如无必要勿增实体：优先复用现有页面、数据表、接口和 `apps/web/src/components/ui` 组件；没有真实需要不加表、字段、页面或依赖。
- 这些规则不能削弱：已记账业务通过带原因的撤销回冲纠正，不能删除或覆盖数量与金额（只有没有任何业务记录的申请可以删除）；新业务写操作必须带 `Idempotency-Key`；草稿按版本号保存，过期版本返回 409；有未完成页面时须逐页人工核对才能确认；确认时关联原件，原件缺失不能确认；接口和日志不输出明文密钥。
- 提交前至少运行 `pnpm --filter @canglin/shared build && pnpm typecheck && pnpm lint && pnpm test`；改到导入、工作台、库存流程时再跑浏览器测试（见「测试」）。可选：`git config core.hooksPath scripts/githooks` 启用仓库自带的 pre-push hook，push 前自动跑这组检查、失败即取消 push（默认不启用；停用用 `git config --unset core.hooksPath`，单次跳过用 `git push --no-verify`）。
- 前端遵循 [apps/web/DESIGN.md](apps/web/DESIGN.md)；导入、OCR、AI、备份与回退的行为和接口以 [升级说明](docs/upgrade-2026-09.md) 为准，行为变了同步更新这两份文档。

## 隔离试用

当前已发布候选见 `deploy/trial-candidate.env`（源码提交与三个不可变镜像摘要一起固定）；尚未发布的工作区改动不在这些镜像里。可用 `CANGLIN_TRIAL_CANDIDATE=/绝对路径/candidate.env` 选择另一组已发布候选，脚本不会执行该文件中的 shell 内容，启动前逐个校验镜像的源码提交。项目、配置目录及数据卷按提交编号独立于正式环境。启动、检查与清理用 `bash deploy/trial.sh up|check|status|logs|stop|smoke`，入口为服务器本机 `http://127.0.0.1:18080`，`stop` 只停容器、保留试用数据。同一端口一次只启动一个候选。

代理后的审计 IP 通过 `TRUST_PROXY_HOPS` 和 `TRUST_PROXY_CIDRS` 同时限定：直接访问应用 nginx 为一层；外层 OpenResty → 应用 nginx → API 为两层，且 web 必须绑定本机端口以阻止绕过外层。CIDR 宜取 `docker network inspect` 查到的本项目网段。API 直连时设零层。应用默认仅信任 loopback；Compose 默认信任 Docker 的 `172.16.0.0/12` 且最多一层。不要信任所有地址或任意长度的转发链。

本轮新增付款与开票工作台及对应验收记录见 [2026-10-23 扩展开发与验收](docs/next-iteration-acceptance-2026-10.md)。

Beta 2 选定范围、实现进度及待发布步骤见 [开发计划与交接](docs/next-steps-beta.2-2026-10.md)。询价比价与周期采购不在本轮范围内。
