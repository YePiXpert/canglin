# 按量采购工作流、原件识别与升级

本文记录 2026-09-30 重构后的业务接口、原件识别与部署维护。需求已经确认，见 [重构需求](./rebuild-requirements.md)。技术栈仍为 Vue、Nest/Fastify、SQLite 与 Python OCR；主导航为工作台、申请、库存与领用、报表、系统设置。

新主流程使用独立的申请、业务单据、库存余额和不可覆盖的库存流水，不推算或伪造历史采购、到货事实。旧表与旧路由曾保留兼容，已由 2026-10-08 的迁移删除（见[删除旧台账与加固](#2026-10-08-删除旧台账与加固)）。本次开发不清空既有目录；在新测试库执行迁移即可使用新主流程。

## 2026-10-26 · 零散采购与多购备货

采购登记可跳过数量为0的行，超出剩余申请的数量单独记为多购备货，实际到货后沿用直发/入库流程。新增迁移 `20261026000000_allow_over_purchase` 只为业务明细追加 `overPurchaseUnits=0`；旧采购金额与数量不变，保留原申请的数量上限 CHECK。新版本按“实际采购 − 多购”维护申请承诺，旧应用不能写入已含多购记录的新库；回退须同时恢复升级前数据库和旧镜像。用户已授权推送并部署，具体规则及验证见[零散采购与多购备货](purchase-surplus-2026-10.md)。

## 2026-10-23 · 1.0.0-beta.2（开发完成，待发布）

新增集中采购、资金与发票金额对账、手机扫码作业、异常/月报和 AI 操作草稿。使用流程、实际 `/api/execution` 接口、AI 数据发送及金额口径见 [Beta 2 执行与结算](execution-settlement-2026-10.md)。本轮未部署，生产仍为 Beta 1。

迁移 `20261024000000_execution_settlement` 保留旧采购标记，新列默认 `LEGACY`，不会自动生成付款流水；界面新采购使用 `DETAIL`。发票有效号码的部分唯一索引、附件唯一归属触发器及金额 CHECK 只在真实迁移中完整建立，部署不能使用 `prisma db push`。完整库备份会携带新增资金、票据、草稿、审计和原件。

升级前停写并保存完整回退点，回退时成对恢复旧数据与旧镜像。生产 Compose override 固定镜像摘要，单改 `RELEASE_TAG` 不会更新运行镜像。发票 AI 识别需要图像与结构化输出能力，操作建议需要结构化输出；都不会直接确认业务。二维码在浏览器本地识别。

## 2026-10-23 · 1.0.0-beta.1

本版新增库存盘点、补货规则/草稿和采购跟进，迁移为 `20261023000000_inventory_planning`。使用入口、实际 API 和验收见 [Beta 交付记录](release-1.0.0-beta.1.md)。库存版本必须由所有写入端维护；回退时停写并成对恢复升级前数据与旧镜像，不能让旧应用与新盘点流程混跑。

## 实现与默认值

| 范围 | 行为 |
| --- | --- |
| 草稿 | 未知数量为 null，申请日期不补当天；独立行、稳定 lineId、逐页来源、乐观版本号、修改历史 |
| 确认 | 严格数量/价格校验；保留原件物理行，含同名行；规格和单位参与物品身份；任务只能确认一次 |
| 原件 | 内容哈希提示重复，可直接打开已有任务，用户明确继续才创建新任务；未确认原件保留 30 天，上传及每 6 小时清理到期任务；确认后的来源长期保留 |
| OCR | Python 3.11、PaddleOCR 3.7.0、PaddlePaddle 3.3.1、PP-OCRv6 medium；方向识别开启，去畸变关闭；检测阶段最长边 2560（与输入一致）；照片识别前转灰度并拉伸对比度 |
| OCR 资源 | 一个进程/推理实例/活动解析，2 CPU、4GB 内存、2 推理线程，页面最大边 2560；30MB、自动最多 30 页 |
| 文本层 PDF | 按表格边框与词坐标重建物理行列（网格重建），不渲染、不 OCR；单页约 30–200 毫秒 |
| AI | Responses，第三方 baseURL 可配置；文本层 PDF 页走审核模式，截图、照片与扫描页走识别模式，本地 OCR 备用；能力按实际请求检测 |
| 请求 | 智能导入并发 1，单页输出最多 12000 tokens（含推理），120 秒；429/500/502/503 最多重试一次，不确定超时不自动重发；服务以 400 拒绝 temperature / reasoning 时去掉后重发一次并记住 |
| 用量 | 输入/输出 tokens、模型、耗时、请求标识；缺少用量为未知，未配置价格不计算费用 |
| 库存 | 品名、规格、单位构成物品身份；收货待处理与库存分开；直发余量不自动入库 |
| 写防重 | 申请、采购、收货、入库、发放、退回、取消、调整及撤销等写操作必须带 Idempotency-Key；同事务持久化请求指纹及结果 |

模型文件在构建期预下载，以 `apps/ocr/models.sha256` 校验；依赖来自 `apps/ocr/requirements.lock`。禁止运行时补下载作为正常启动流程。真实 CPU 测试发现当前 oneDNN 路径不兼容，已明确关闭 MKLDNN；更新此设置需重跑真实容器测试。

首次识别结果、AI 重试建议和人工草稿分开保存。页图统一经 OCR 服务的 `/page` 预处理（照片转正、缩放到 2560 并转 JPEG，截图与 PDF 页为 PNG；OCR 服务不可用时图片仍按原图发送）；文本层 PDF 由网格重建取得物理行，AI 只做核对与品名拆分，均无需启动 OCR 模型。失败页才回退本地 OCR。后台迟到结果不能覆盖人工编辑；重试保留历史。AI 识别的行只有页级定位，不会伪造坐标；审核模式的行就是文本层的物理行，保留其真实坐标。原件文本只作为数据，自动识别不携带业务写工具；问答仍使用只读工具白名单、参数校验和六轮工具上限。

## 配置第三方 Responses

1. 设置 `LLM_BASE_URL`、`LLM_MODEL` 和服务器 `LLM_API_KEY`，或将 secret 文件挂载到服务器并设置 `LLM_API_KEY_FILE`。不要把 secret 放到 uploads。Compose 使用 secret 文件时用 `docker-compose.override.yml` 增加只读挂载和环境变量（示例见下）。该文件不提交到仓库，升级保留它。
2. 服务器密钥配置一次后，设置页显示“服务器已配置 Key，无需填写”。已有密钥时自动从已保存服务的 `GET /models` 获取模型，只需选择一个模型，识别、问答和搜索共用；旧配置中的分任务模型不再生效，曾单独指定任务模型时需重新检测能力。服务地址或密钥改动后先保存，再获取列表；可选模型由服务器环境变量 `LLM_ALLOWED_MODELS` 决定：未设置时为 `gemini-3.8-flash-high`、`gpt-6.1-sol`（识别和问答固定中等思考）与 `grok-4.7`；逗号分隔可换成别的列表，`*` 表示不限制（设置页改为直接填写模型名，候选来自服务商的列表）。启用状态下保存允许列表外的模型返回 400；列表收窄后库里已保存的模型不在列表里时，识别与问答继续用它，设置页会提示，关闭 AI 助手仍可直接保存，换成列表里的模型并保存后才切换；获取列表失败时仍可从允许的选项中选择。改这个变量后在部署目录执行 `docker compose up -d server` 重建 server 容器（`restart` 不会读取新的 `.env`）。列表不代表 Responses 能力，也不会自动更改模型或启用 AI。旧数据库密钥兼容；服务器密钥优先，界面及日志不返回明文。
3. 点击能力检测。测试使用合成图像和固定文本，分别验证文本、图像、严格 JSON Schema、工具调用与结果回传。更换服务、密钥或模型会使结果失效。
4. 图像和结构化输出通过后，明确打开自动智能导入并保存。工具检测失败仅限制问答。
5. 新单优先由 AI 识别原件，失败页回退本地 OCR。用户可取消后台处理，核对原件并继续。AI 或 OCR 任一方式完成后仍须人工确认最终草稿；两种方式均未完成的页面须补录并逐页记录人工核对。后端返回统一的 `reviewPages` 清单，并在确认事务中按同一规则校验，停用配置不能抹去未完成页面的核对要求。

secret 文件示例（文件路径由管理员在 VPS 上准备，权限应仅允许服务读取）：

```yaml
# /opt/canglin/docker-compose.override.yml
services:
  server:
    environment:
      LLM_API_KEY_FILE: /run/secrets/llm_api_key
    volumes:
      - /opt/canglin/secrets/llm_api_key:/run/secrets/llm_api_key:ro
```

`store:false` 只是请求参数，不代表第三方零留存。模型名称不代表能力。设置页不再提供计价和预算项；未配置时只记录用量，预算默认关闭。历史单价与预算记录保留兼容，币种由服务商决定。月预算按已记录的导入估算费用停止后续请求，单页请求可能跨过阈值；它不是第三方账单硬限额。问答和搜索不计入导入预算。

识别成功与费用记账分开：截断、拒绝、JSON/Schema 错误只要带有可信用量，就按该次配置单价估算费用。发出后没有用量的失败调用费用为未知，启用预算时阻止后续自动请求；在页面渲染等发送前步骤失败的调用标记为 `NOT_SENT`，费用为 0，不占预算。旧记录缺少费用依据时仍保持未知，不使用当前单价补造历史账单。预算拦截只结束 AI 阶段，保留已完成的识别草稿，允许明确人工核对后继续入账。

## API 与数据兼容

- `POST /api/imports/tasks/:id/discard`：携带当前草稿 `{version}`，放弃未入账任务并删除草稿、识别历史及原件；正在识别的任务同时停止，迟到结果不会重新创建任务。已入账、版本过期或原件已有业务附件引用时拒绝删除。AI 用量记录保留，避免影响预算累计；重新上传同一原件会创建新任务。

- `POST /api/imports/upload`：multipart 单文件；内容与已有任务相同时只返回 `{duplicateTaskId}`、不创建任务：优先指向最新的未确认任务，都已确认时指向最近确认的那个；带 `?continueDuplicate=true` 才新建。
- `GET /api/imports/tasks?confirmed=false|true&page=1&pageSize=10`：只读任务列表，只按 `confirmedAt` 筛选（`false` 为未确认入账，包括本地识别已完成的任务），按上传时间倒序；`page` ≥ 1，`pageSize` 1–50（默认 10），参数不合法返回 400。返回 `{tasks,total,page,pageSize}`，每行只有 `id`、`filename`、`createdAt`、`finishedAt`、`status`、`aiStatus`、`confirmed`、`confirmedAt`、`originalAvailable`，新流程已确认任务另带 `requestId`；不返回存储路径、识别结果、草稿、AI 结果或确认快照，也不触发识别、重试或清理。
- `GET /api/imports/tasks/:id`：阶段状态、草稿版本、逐页结果、`reviewPages`（页码、原因、人工核对状态）、建议及调用记录。任务不存在（编号有误或已被清理）时返回 404；导入页据此显示说明、停止轮询，不自动新建任务。
- `PUT .../:id/draft`：`{version,draft}`；旧版本返回 409，不覆盖当前编辑。
- `GET .../:id/revisions`：本地识别与人工草稿版本记录。
- `GET .../:id/original`、`GET .../:id/pages/:page`：鉴权读取，服务端路径不对外暴露。
- `POST .../:id/retry`：`{stage:"local"|"ai",pages?:number[]}`；`POST .../:id/cancel` 取消当前代次。
- `POST /api/workflow/imports/confirm`：人工确认后的最终值、taskId、version，以及 Idempotency-Key 请求头；同一事务校验任务/页核对/版本、建立申请与原件关联、标记确认并记录审计。旧 `POST /api/imports/confirm` 已随旧台账删除。
- `POST /api/ai/capabilities`：检测 Responses 的实际能力。2026-10-12 起不再提供 `POST /api/ai/ocr-review`（返回 404）。
- OCR `/health` 为进程存活；`/ready` 要求加载模型并完成小样例推理。OCR `POST /parse?page=N[&mode=text]`、`POST /page?page=N[&strips=1]`、`POST /inspect` 只供服务端调用，见[识别优化](#2026-10-12-ocr-与-ai-识别优化)。

新增迁移 `20260927000000_trusted_import`，增加 ImportTask 字段、ImportRevision、OperationReceipt、AiCall。历史解析读取时补稳定历史 ID，未知值保持空；没有依据的历史字段不创建框选。历史台账和 Float 数据不重归并、不转换（2026-10-08 起随旧表删除）。

## 新业务接口与数据库

新迁移 `20260930000000_quantity_workflow` 建立 `CatalogProduct`、`ProcurementRequest`、`ProcurementLine`、`BusinessDocument`、`BusinessLine`、`StockBalance` 与 `StockEntry`，以及申请/业务单据附件关系。所有新关联均有外键；已记账单据与库存来源受到删除约束。

- `GET /api/workflow/requests`、`requests/:id`：申请与逐行进度，支持待办阶段筛选和分页。
- `POST /api/workflow/requests`：人工创建；来源任务只能经导入确认接口绑定。
- `POST /api/workflow/purchases`、`receipts`：多供应商分次成交与按量收货。
- `POST /api/workflow/stock-in`、`distributions`：明确入库、直发或库存领用。
- `POST /api/workflow/supplier-returns`：退款退货或换货；`employee-returns`：员工归还入库。
- `POST /api/workflow/purchase-cancellations`、`request-cancellations`：取消尚未收货的采购量、尚未采购的申请量。
- `POST /api/workflow/adjustments`：带原因的库存增减；`documents/:id/void`：检查下游依赖并追加反向流水。
- `PATCH /api/workflow/documents/:id/metadata`：付款/报销、开票与备注。
- `GET /api/workflow/stock`、`entries`、`documents`、`overview`、`reports`：只读库存、流水、历史与统计。
- `POST /api/attachments/requests/:id`：补充原件；`documents/:id?kind=INVOICE|SIGNOFF`：采购发票或发放签收。已入账申请原件不可删除。

新数量以六位定点整数存储，单价四位，金额两位，接口返回十进制字符串。行金额使用四舍五入，聚合累加行金额。退款减少净成交，换货不减少；收货与实物退货单独统计。日期筛选按每次业务发生日期，跨期退款可使当期净额为负。不同物品、规格或单位的数量不混加，领用次数按发放单去重。

旧 Float 台账不转换为新采购事实：2026-10-08 的迁移直接删除旧表，恢复更早的备份时也会先在隔离副本执行同一迁移，其中的旧台账数据同样被删除；正式使用从新的申请开始。

## 2026-10-08 删除旧台账与加固

迁移 `20261008000000_drop_legacy_hardening` 删除旧台账的 `Item`、`ItemHistory`、`Distribution`、`DistributionLine`、`Product`、`InventoryMovement`、`SupplierPriceRecord` 表及索引。按[重构需求](./rebuild-requirements.md)，既有数据只是测试数据，迁移直接删除、不转换；对应的服务端模块、路由（`/api/items`、`/api/distributions`、`/api/inventory`、`/api/reports`、`POST /api/imports/confirm`）、前端页面与 `packages/shared` 里的旧契约一并移除，旧地址由前端路由重定向到新页面。

- **附件**：只挂在旧台账或旧发放单上的附件记录随表删除（文件留在 `uploads/`，可手工清理）；已确认导入的 OA 原件挂在申请上，保留。`Attachment` 重建时沿用原来的自增计数，审计日志和历史链接里的旧附件 id 不会被新记录复用。
- **导入任务**：经旧确认路径入账的任务重置为未确认（草稿与识别结果保留），之后按未确认原件 30 天的保留规则清理；新流程确认的任务不受影响。
- **约束与索引**：`ImportTask.status`、`BusinessDocument.source` / `returnMode` 增加 CHECK（Prisma 看不到 CHECK，`migrate diff` 不会报漂移）；新增 `AuditLog(entity, entityId)` 与 `OperationReceipt(createdAt)` 索引。
- **服务器时区**：`docker-compose.yml`、`deploy.sh` 生成的 `.env` 与 `.env.example` 设 `TZ=Asia/Shanghai`（服务端镜像安装 `tzdata`）。每日 03:00 的维护任务按该时区执行：清理 90 天前的操作回执、库存对账；遇到备份/恢复维护锁时每 15 分钟重试，最多 4 次，否则留到次日。
- **库存对账**：`POST /api/system/stock-check` 立即核对每个库存余额与流水合计，结果也出现在 `GET /api/system/status` 的 `stockCheck`；不一致只写审计日志，不自动修正。
- **导入只记申请事实**：导入页不再收集单价与采购链接，成交价和链接在登记采购时填写（2026-10-15 起原件上的采购链接改为随明细入账、登记采购时预填，见文末「2026-10-15 导入单位、采购链接与删除申请」）；`workflowImportConfirmSchema` 去掉 `supplierId`、`operationId`（操作编号只走 `Idempotency-Key` 请求头），草稿契约去掉 `supplierId`、`duplicateAction`。OCR/AI 读到的单价字段仍留在原始识别结果里，仅供核对。
- **语义搜索**：开启后 `/api/workflow/requests`、`documents`、`stock` 的 `search` 用词表内的同义词扩展品名匹配，词表来自申请明细品名与物品目录。
- **验证口径**：`deploy/tests/smoke-api.cjs` 改走新接口（导入确认建申请 → 备份 → 取消一行 → 恢复 → 校验申请与原件）；CI 增加前后端 lint；本地验证数字见 README。

## 2026-10-10 改名为仓廪并发布 v2.0.0

项目改名为「仓廪」（技术名 `canglin`），版本从 v2.0.0 重新开始。只有一位使用者，不保留旧名兼容期。

| 项目 | 旧名 | 新名 |
| --- | --- | --- |
| 显示名 | Procure Lite | 仓廪 |
| 仓库地址 | `https://github.com/YePiXpert/procure-lite` | `https://github.com/YePiXpert/canglin` |
| 镜像 | `ghcr.io/yepixpert/procure-lite-{web,server,ocr}` | `ghcr.io/yepixpert/canglin-{web,server,ocr}` |
| Compose 项目 | `procure-lite` | `canglin` |
| 数据卷 | `procure-lite_procure-state`（卷键 `procure-state`） | `canglin_state`（卷键 `state`） |
| 安装目录 | `/opt/procure-lite` | `/opt/canglin` |
| 包作用域 | `@procure-lite/*` | `@canglin/*` |
| 目录环境变量 | `PROCURE_REPO`、`PROCURE_TRIAL_DIR` | `CANGLIN_REPO`、`CANGLIN_TRIAL_DIR` |
| 回退镜像标签 | `procure-lite-rollback-*` | `canglin-rollback-*` |
| 数据库文件 | `procure.db` | `canglin.db` |
| 浏览器主题存储键 | `pl-theme` | `canglin-theme` |
| 前端内部幂等键前缀 | `procure-operation:`、`procure-workflow:` | `canglin-operation:`、`canglin-workflow:` |

**迁移**已于 2026-10-10 在唯一实例上一次性完成：停止旧项目 → 目录 `/opt/procure-lite` 改为 `/opt/canglin`、Git 远端与 `.env` 的项目名改写 → 旧卷内容复制到 `canglin_state` 并把数据库文件改名、属主交给 uid 1000 → 用新脚本升级。脚本不含迁移逻辑，旧卷、旧网络、旧镜像已清理。2026-10-10 之前的备份归档里数据库条目名为 `procure.db`，恢复时仍能识别。

**回退**：`rollback.sh` 固定使用项目 `canglin` 和数据卷 `canglin_state`；回退后的手工管理命令见下文（`-p canglin`）。

**容器加固**：

- **server 以 node 用户运行**（uid 1000）：运行阶段用 `COPY --chown=node:node` 复制产物，不在事后 `chown -R /app`（那样会把整个 node_modules 再复制成一层，每个版本都要重新下载）；`/app/state` 归 node，新建的数据卷首次挂载时继承该属主，唯一实例的数据卷已在迁移时交给 uid 1000。入口脚本在数据目录或 `canglin.db` 不可写时直接报错并给出 chown 命令；`npx prisma migrate deploy` 与 `node dist/main.js` 均无需 root。
- **server 健康检查**：`GET http://127.0.0.1:3000/api/auth/status`（全局前缀 `api` 下的公开路由，会查询数据库），间隔 30 秒、超时 5 秒、启动宽限 40 秒、重试 3 次。web 用 `depends_on: server: {condition: service_healthy}` 等 server 健康后再启动，因此 `docker compose up` 要等首次检查通过（约 30 秒）才返回；server 起不来时 `up` 直接失败，部署脚本打印日志，升级脚本打印回退命令。
- **web 健康检查**：`wget -qO- http://127.0.0.1/`（nginx:alpine 自带 busybox wget），只检查静态页。
- server 对 ocr 仍是普通 `depends_on`：OCR 加载模型慢，不让 server 等 OCR 健康；OCR 就绪仍由部署和升级脚本单独检查。
- **OCR 仍以 root 运行**：PaddleOCR/PaddleX 在构建期把模型下载到 `/root/.paddlex/official_models` 并按 `models.sha256` 校验，运行时也使用主目录下的缓存和配置。改用户需要同时迁移这些路径、权限和校验步骤并重新做真实模型验收，本次不改。

**版本与标签**：旧的 v1.2.x 标签属于重写前的旧代码库，已从仓库删除，版本从 v2.0.0 重新开始，变更见 [CHANGELOG](../CHANGELOG.md)。早先拉取到本机的旧标签不会被 `git fetch --tags` 自动删除，不影响升级。

**试用环境**：`deploy/trial-candidate.env` 集中保存一个 40 位源码提交和三项不可变镜像摘要，当前已发布候选为 `0813b985ff930a782dea0c6b7c76807dfdf3489f`。`deploy/trial.sh` 逐个核对镜像的 `org.opencontainers.image.revision`，项目和卷名使用该提交的前 12 位（`canglin-trial-0813b985ff93`、`canglin-trial-0813b985ff93_trial-state`），只监听 `127.0.0.1:18080`，不读取正式环境密钥。`CANGLIN_TRIAL_CANDIDATE` 可指定另一组候选文件；切换前先用原文件执行 `stop`，不会删卷。工作区的新功能需在 CI 发布对应三个镜像后更新候选文件，不能把已有镜像摘要标成新提交。`smoke` 使用候选提交自己的验收脚本，在断网、空临时卷中测试备份恢复。

**反代 IP 配置**：当前 Fastify 对纯数字 `trustProxy` 采取拒绝信任策略；API 改为同时检查 `TRUST_PROXY_CIDRS` 中的代理地址和 `TRUST_PROXY_HOPS` 上限。默认直接访问应用 nginx 为一层。外层 OpenResty → 应用 nginx → API 的部署应设 `TRUST_PROXY_HOPS=2`、`WEB_PORT=127.0.0.1:8080`，并用 `docker network inspect` 确认、限定本项目网段。API 不应公开端口。单层、两层、IPv4 映射地址、无转发头、伪造直连及最左侧地址均有回归测试；部署配置本身需在升级时应用，历史审计 IP 不回填。

## 2026-10-12 OCR 与 AI 识别优化

方案与原件分析见 [docs/ocr-ai-optimization](./ocr-ai-optimization/README.md)。识别结果仍须人工确认后入账，业务数量规则不变。

**文本层 PDF 网格重建**：带文本层的 OA 打印页（致远「办公用品领用单」「固定资产购买申请单」及同类表格）按表格边框与词坐标恢复物理行与列：竖线按与表体重叠长度之和计覆盖度，词按水平重叠最大归列，格内换行直接拼接（型号、链接、部门名常按字符拆行），没有序号和数量的行并入上一行，续页沿用上一页的列定义（单页请求先推算前面各页的列）。品名保留名称单元格原文，备注能解释为单位（「50张」「一个」且与数量相符）才取单位，其余备注文字并入规格并提示核对拆行；固定资产单的规格型号、主要技术指标与生产厂家合并为规格，预计总价写入 `amount` 并与数量×单价交叉校验。单据头按「标签词右侧同一行」取值，部门名换行拼接，经办人可以是岗位名。浏览器页眉页脚、插入项、合计、审批链不成行。已识别模板的原件不再退回旧的逐行解析（它在固定资产单上每份产出三十多条假明细）；文本层存在但没有表格的页面不再渲染 OCR。`parserVersion` 为 `4`。

**AI 识别分两种模式**（提示词与版本号集中在 `apps/server/src/ai/prompts.ts`；2026-10-15 起为 `review-v2` / `recognition-v3`，每行加推测单位 `unitGuess`，见文末）：

| 页面 | 模式 | 模型的任务 | 服务端校验 |
| --- | --- | --- | --- |
| 文本层 PDF 且网格重建出明细行 | 审核 `review-v1` | 页图 + 文本层的行：核对行数与列归属，拆分品名与规格，判断单位 | 行（lineId）必须与文本层一一对应，否则按契约错误回退；数量、单价、金额、链接与已有单据头一律用文本层的值，模型读数不同只提示；规格列（规格型号、主要技术指标、生产厂家）的内容保留在规格里；品名格为空的行照样保留。重试时本页已有明细必须正是这些物理行（lineId 与原文都对得上），否则按识别模式重识别（旧解析器同样用 `p页-r序号` 作 lineId，但指向的行不同） |
| 文本层 PDF 但没有明细行 | 识别 `recognition-v2` | 页图 + 本页文本层（最多 6000 字）主识别 | 链接必须能由文本层片段按顺序拼出（备注格里按字符换行的链接也算），否则置空并提示 |
| 截图、照片、扫描页 | 识别 `recognition-v2` | 页图主识别 | 日期不合法置空、空品名的行丢弃、数量×单价与金额不符提示 |

输出契约 v2 每行带名称单元格原文 `rawText`、`amount` 与可选的 `catalogSuggestion`，不再要求每行写 `reason`；单据带 `templateType`。附带物品目录（最近 300 个「品名 + 规格 + 单位」）时，模型可给出与已有物品完全相同的一条作为归一建议，界面显示「匹配到已有物品」，由用户点「采用已有物品」替换，绝不自动替换。调用记录 `AiCall` 新增 `mode`（`RECOGNITION` | `REVIEW`）与 `promptVersion`（附带目录或分段时带 `+catalog` / `+strips`），任务视图的调用记录一并返回。AI 路径的 `parserVersion` 为 `ai-primary-2`；审核页的页模式（`pages[].mode`）为 `AI_REVIEW`，整份结果的 `mode` 仍按 `AI_IMAGE` 汇总，回退到旧版本时旧契约也能读取已保存的结果。

**调用参数**：识别与审核 `max_output_tokens` 12000；`temperature` 与 `reasoning` 真正写入请求，默认识别 `low`、问答 `medium`、搜索与能力检测不发；服务以 400 点名拒绝时去掉该参数重发一次，并按配置指纹记在 `aiParamSupport` 设置里，之后不再发送（重新做能力检测或更换服务、密钥、模型后重新学习）。输出因 `max_output_tokens` 截断时提示「模型输出超过上限，请减少单页行数或拆分页面」，原因记入调用记录。设置页「高级配置」可选推理强度（自动 / 不发送 / 最低 / 低 / 中 / 高，「不发送」时温度也不带）与「文本层 PDF 也请模型核对」（默认开；关闭后文本层页面同截图一样走识别模式）。重试只把定位所需的 `lineId、itemName、spec、quantity、unit` 作为 `existingRows` 发给模型。

**只读问答**：提示词补充相对日期换算、最多 6 轮工具调用与先汇总后钻取、同名多物品先列候选、Markdown 表格与截断提示；工具结果改为结构化精简（去掉空值与时间戳，附件只留类型和文件名，每张单据最多 20 行，仍超过 16000 字符时从末尾删条目并标记 `truncated` 与 `hint`），不再截出残缺 JSON；`query_documents` 默认每页 10 条、`query_stock` 默认 30 条。语义搜索的缓存键带词表哈希，词表变化后旧的扩展结果失效。

**本地 OCR 路径（截图、照片）**：列区间扩展到相邻表头的中点，单元格按水平重叠最多归列，序号列只放整数（表头居中的窄序号列旁，左对齐的短品名归品名列）；两行表头（规格/型号、生产/厂家）合并；有序号列的表，没有整数序号也没有数量的行并入上一行，没有序号列的表只把只含品名或规格的紧邻行当换行（数量以数字开头，如「2箱」，就是新的一行）；品名格为空但有数量和其他文字的行保留并提示；遇插入项、合计、总金额关闭表格；找到表格后，表外文字（单位名、单据头标签、审批意见）只用来取单据头，不再按行猜明细；数量、单价、金额单元格把常见误识字符换回数字（O→0、l/I/|→1、数字间的「。」→小数点），换后仍不是数字的留空并提示；整行置信度低于 0.6、数量或单价低于 0.8 时提示，前端给低置信度行加底色与「识别置信度低」标记；单据头先按标签规则取值（一个框里写了几组「标签：值」时按标签切开，上下排列的标签清单里值归属纵向最近的标签），再用全文规则补。没有表头的续页仍按逐行规则解析（扫描多页时可能产生假明细，开启 AI 时由识别模式处理）。

**迁移**：`20261012000000_add_ai_call_prompt_version` 给 `AiCall` 增加可空的 `promptVersion`、`mode`，不回填；回退代码不需要回退迁移。

**OCR 接口**（服务端内部调用）：`POST /parse?page=N&mode=text` 只读文本层与网格重建，不渲染、不 OCR，返回本页明细与 `textLayer`（正文，没有文本层时为 `false`）；`POST /page?page=N` 的响应类型以实际编码为准（`image/jpeg` 或 `image/png`）；`POST /page?page=N&strips=1` 把高宽比超过 1.6 的长截图在空白带处切成 1–3 段，返回 `{"mime","images":[base64…]}`。

**开关与回退**：

| 范围 | 开关 | 行为 |
| --- | --- | --- |
| 网格重建 | OCR 环境变量 `OCR_GRID_REBUILD=0` | 跳过网格重建，回到 `find_tables` 与逐行解析 |
| 审核模式 | 设置页「文本层 PDF 也请模型核对」 | 关闭后文本层页面走识别模式，网格结果仍作为本地结果 |
| 调用参数 | 设置页推理强度「不发送」 | 请求不带 `reasoning` 与 `temperature` |
| 页图预处理 | OCR 环境变量 `OCR_PAGE_PREPROCESS=0` | `/page` 只渲染与缩放，照片不转 JPEG |
| 照片 OCR 预处理 | OCR 环境变量 `OCR_PHOTO_PREPROCESS=0` | 识别前不转灰度、不拉伸对比度 |
| 检测尺寸 | OCR 环境变量 `OCR_DET_LIMIT_SIDE_LEN=0` | 回到 Paddle 默认的检测缩放 |
| 长截图分段 | 服务端环境变量 `AI_IMAGE_STRIPS=1` 开启 | 默认关闭，评测通过后再开 |
| 数据库 | 不需要 | 新字段可空 |

**评测**：`scripts/evaluate-imports.py` 的变体与基线改为参数（manifest 顶层 `variants`、`baseline`，或 `--variants`、`--baseline`，最后一个变体是最终流程）。`scripts/export-text-layer-fixtures.py` 把人工核对过的标准答案与原件导出为脱敏夹具（姓名换占位、审批时间戳固定、页脚地址与 jsessionid 清零、京东跟踪参数按原长度替换），放到 `apps/ocr/tests/fixtures/seeyon/` 后由 `test_seeyon_fixtures.py` 逐份对照；部门、品名、数量、单号仍保留，提交前须确认可以入库。

## 验证命令

```sh
pnpm install --frozen-lockfile
pnpm --filter @canglin/shared build
pnpm --filter @canglin/server build
pnpm --filter @canglin/server test
pnpm --filter @canglin/web typecheck
pnpm --filter @canglin/web test
pnpm --filter @canglin/web exec playwright install --with-deps chromium
pnpm --filter @canglin/web test:e2e
python3 -m unittest discover -s deploy/tests -v
python3 -m unittest discover -s scripts/tests -v
(cd apps/ocr && pytest)
docker build -f deploy/Dockerfile.ocr -t canglin-ocr:runtime-test .
docker build -f deploy/Dockerfile.ocr-test -t canglin-ocr:test .
docker run --rm --network none --cpus 2 --memory 4g canglin-ocr:test
docker run --rm --network none --cpus 2 --memory 4g canglin-ocr:test python -m tests.smoke_engine
```

浏览器测试启动独立临时 SQLite 和真实 API，OCR/AI 使用明确的合成替身；不访问生产数据。协议错误测试另外覆盖 Responses 请求与异常。真实 OCR 容器验收命令在断网和资源限制下运行模型；实际执行状态须查对应验收记录，合成测试通过不代表本次已完成真实模型验收。

## 备份、恢复与回退

新业务备份包含数据库、uploads、格式版本、schema 指纹和逐文件 SHA256 清单，不包含外部 secret。维护门禁拒绝新请求并排空已开始的任务（客户端已断开、服务端仍在处理的请求也要等它处理完），保证引用与文件一致。恢复先在临时目录检查数据库、外键、文件及哈希；旧备份在隔离副本执行迁移。替换时保留旧数据库与原件目录，并写入持久恢复日志。

中断恢复在 Prisma 打开数据库前执行；容器入口也在迁移前执行恢复。WAL/SHM 在切换时处理，连接设置重新应用，旧会话失效，配置和定时任务刷新。数据库与文件切换失败会恢复完整旧状态。

生产发布是独立步骤：本地验证与测试不运行部署脚本、不修改现网。

```sh
# 拉取同一源码标签（sha-xxxxxxx）的全部三个镜像；拉不到时在停机前退出，不回退本地构建
bash deploy/upgrade.sh /opt/canglin
# 确认要用本机源码（未经 CI 测试）时显式构建全部三个镜像；OCR 构建失败必须失败退出
bash deploy/upgrade.sh /opt/canglin --build
# 回退必须同时恢复旧数据和固定的旧镜像
bash deploy/rollback.sh /opt/canglin /opt/canglin/pre-upgrade-backups/release-TIMESTAMP
```

升级脚本先检查旧数据卷、旧镜像和备份工具，拉取三个新镜像（加 `--build` 时改为本地构建）后才停机；拉取失败（该提交的 CI 还没跑完或没通过、私有包未登录）时在停机前退出，源码退回升级前的提交、删掉这次的回退点记录，不会自动改为本地构建。仓库更新使用 `git merge --ff-only origin/main`，已跟踪文件有改动时退出，不再清理本机未跟踪的配置。成功获取镜像后将源码标签持久化为 `.env` 中的 `RELEASE_TAG`；首次部署同样如此。日常 `docker compose up` 沿用该版本，不会自行切换到 latest。默认项目名和数据卷为 `canglin` / `canglin_state`，自定义项目名需单独调整部署流程。

发布记录包含旧/新源码、迁移校验、三个镜像 ID、OCR 版本及模型就绪结果。升级前三个服务都没有容器（例如已手工停机）时没有旧镜像可记，脚本警告后跳过回退点记录、数据照常备份，这样的发布目录不能用 `rollback.sh` 回退（脚本在停机前拒绝）；只有部分服务缺容器时升级在停机前退出。自动回退点不会清理，稳定后由管理员归档。不要仅回退代码而继续使用迁移后的数据库。旧版服务器凭据仍由部署环境管理，应用不会自动替换服务商或密钥。

回退前会验证备份、旧镜像和数据卷；停止服务后，先另存 `before-rollback-*.tar.gz`，再恢复升级前的数据。回退会移除升级后新增的业务记录，但这些记录保留在回退前快照中。恢复旧版使用保存的旧 Compose 配置、当前本机 override 和固定旧镜像；外部 secret 由管理员保持兼容。中途失败时服务保持停止，应先核对日志和两份完整数据快照后恢复，不能直接启动残留数据。

回退后源码仍为新版本，**管理旧版容器必须显式使用旧配置与旧镜像文件**。不要直接运行普通的 `docker compose up` 或 `--build`，以免重新启动新版：

```bash
cd /opt/canglin
release_dir="$PWD/pre-upgrade-backups/release-TIMESTAMP"
# 有本机 override 时，在 old-compose.yml 和 old-images.yml 之间追加
# -f "$PWD/docker-compose.override.yml"
docker compose --env-file .env -p canglin --project-directory "$PWD" \
  -f "$release_dir/old-compose.yml" -f "$release_dir/old-images.yml" ps
# 把最后的 ps 换成 logs、restart 或 up -d --no-build --pull never 管理旧版。
```

再次升级使用 `upgrade.sh`，会重新备份当时运行的数据和旧镜像。不要删除仍需回退的目录或清理其中引用的镜像。`.env` 和外部 secret 不在业务备份中；`pre-upgrade-backups/`、本机 override 和 `secrets/` 已从 Git 与构建上下文排除。

## 仍需完成的外部验收

验收记录见 git 历史（提交 `ce8fe2e` 前的 `docs/upgrade-acceptance.md`）。真实第三方地址/密钥、30—50 份脱敏业务单据以及生产数据库未提供。模拟测试和合成样例不能代替第三方能力、业务准确率、真实页面 P95/持续内存、历史精度差异或目标部署环境回退演练。因此发布验收保持未通过。

协议参考：[Responses 迁移](https://developers.openai.com/api/docs/guides/migrate-to-responses)、[结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)、[无状态推理条目回传](https://developers.openai.com/api/docs/guides/reasoning)。使用 SDK 的 `toResponseInputItems` 保留可回传条目及不透明的加密推理内容。


## 2026-10-14 统一部署数据目录

正式部署使用 `<部署目录>/data/`（默认 `/opt/canglin/data`），通过 local bind 卷保留 `canglin_state` 名称；容器内仍为 `/app/state`。部署和升级脚本把绝对路径写入 `.env` 的 `CANGLIN_DATA_DIR`。首次部署会准备 uid 1000 可写的目录。不要把 data/ 提交 Git。

旧实例运行 `bash deploy/upgrade.sh /opt/canglin`：脚本先下载镜像，停机后备份完整旧卷，再复制到 data/ 和独立的 `canglin_state_legacy_*` 卷，逐文件核对后重新创建指向 data/ 的卷。原权限、附件和 SQLite WAL 一起保留。新目录非空或现有卷指向其他目录时，脚本拒绝自动迁移。迁移中断后不要删除任一副本；根据发布记录、归档及旧卷确认完整数据后恢复。不要用 `docker volume prune` 清掉尚未确认可删除的回退卷。

备份应包括 `data/`、`.env`、`docker-compose.override.yml`、`secrets/` 及所需的 `pre-upgrade-backups/`。外部 secret 仍需单独备份。直接复制 data/ 前先停止 server，复制完成后启动；应用内备份可以在服务运行时使用。恢复到另一台主机时先恢复这些文件，再按新部署目录调整 `CANGLIN_DATA_DIR`，保留 uid/gid 与权限。卷名本身不是备份数据。

`rollback.sh` 恢复旧镜像和数据时继续使用当前 data/ 路径，并在发布目录生成 `storage.yml`。回退后手动 Compose 管理也必须追加 `-f <发布目录>/storage.yml`（存在时），以及原说明中的旧配置、机器 override 和旧镜像文件，不能漏掉存储配置。

## 2026-10-15 导入单位、采购链接与删除申请

方案与实施记录见 [导入单位、采购链接与删除申请](import-units-links-2026-10.md)。

- **迁移 `20261015000000_request_line_link`**：`ProcurementLine` 加可空列 `purchaseLink`（申请里附的采购链接）。迁移同时从导入任务的入账快照回填：按入账时的明细顺序（`input.items[i]` 对应第 `i + 1` 行）取 `lineId`，在当时的识别结果（`local.items`）里找同一行的链接，只填 `http` / `https` 开头、不超过 500 字符的链接。列可空，回退旧代码不需要反向迁移（旧代码不读这一列）。升级前后可以运行 `python3 -I scripts/inspect-units-links.py data/canglin.db`（只读，只输出数量与域名）核对能回填多少条、还有多少明细的单位要人工填。
- **链接**：`linkSchema`（`packages/shared/src/links.ts`）统一校验与精简（先精简再量 500 字，草稿里可以暂存 2000 字以内的原文）：京东、天猫、淘宝、1688、拼多多、苏宁的商品页只留商品编号（去掉跟踪参数与 `#` 后缀，手机版换成电脑版），其他网站原样保留；导入确认、人工录入申请、登记采购、更换链接都经它保存。读接口按规范地址返回链接，存量里带跟踪参数的链接不改写数据也能直接打开。短链接（`u.jd.com`、`m.tb.cn` 等）只提示，不拦保存。不自动检测链接是否有效。
- **新接口**：`GET /api/workflow/products`（物品库：品名、规格、单位）；`POST /api/workflow/requests/:id/delete`（删除申请）；`PATCH /api/workflow/request-lines/:id/link`、`PATCH /api/workflow/purchase-lines/:id/link`（更换链接，body `{ purchaseLink: string | null }`，空串或 null 去掉链接）。写接口照旧要 `Idempotency-Key`。申请视图每条明细带 `purchaseLink`，申请带 `deletable`。审计动作 `WORKFLOW_REQUEST_DELETE`（详情含流水号、明细数、来源任务）、`WORKFLOW_REQUEST_LINE_LINK`、`WORKFLOW_PURCHASE_LINE_LINK`（详情的 `previous` 是旧链接）。
- **删除申请**：只有没有任何业务记录（采购、取消、到货…，含已撤销的单据）的申请可以删除，否则 409。明细与原件附件记录一并删除（文件按引用计数回收，导入任务还持有时保留）；只被这张申请用到、并且是随它一起建出来的物品库条目一并删除（手工新增的库存物品保留）。导入的申请删除后导入任务退回待核对：清空 `confirmedAt` 与 `confirmation`，版本加一（旧页面的确认会被拒绝），入账快照存进修改历史（`ImportRevision.kind = CONFIRMATION`），草稿保留入账时的内容。未确认原件的 30 天保留期对撤回过的任务从最近一次撤回算起（按这条修改历史的时间），不按上传时间立刻清理。
- **AI 推测单位**：输出契约每行新增 `unitGuess`（原件没写单位时的推测单位；写了单位时为 null；带数字或超过 8 个字的由服务端置空）。`unit` 的含义不变，「AI 建议待核对」的判断与 `aiSuggestionKey` 都不含 `unitGuess`，已确认过的建议不受影响。缺这个字段的旧响应按 null 解析；发给服务商的严格 JSON Schema 去掉了 zod 生成的 `default` 关键字。识别结果与草稿里的明细带可选的 `unitGuess`，草稿另带 `unitSource`（`CATALOG` 沿用物品库 / `AI` 推测，人工改过为空）。
- **草稿里的单位与链接**：单位为空的行由前端按「物品库 > AI 推测」自动填并标出来源（原件写明与人工填写的单位不动），入账契约照旧要求单位。草稿每行带 `purchaseLink`（`null` 表示这一行确实没有链接）；这次修复之前保存的草稿缺这个字段，载入时从识别结果按行补回并随自动保存写入。

## 2026-10-16 人工录入：没有 OA 单号，部门与人员少打字

方案与实施记录见 [人工录入：没有 OA 单号，部门与人员少打字](manual-entry-2026-10.md)。

- **迁移 `20261016000000_request_system_serial`**：`ProcurementRequest` 加可空列 `systemSerial` 与唯一索引。存量申请都有自己的流水号，不回填（全是 NULL）。列可空，回退旧代码不需要反向迁移（旧代码不读这一列；但回退后「无OA-…」的申请就当普通流水号显示，补填只能等再升级）。
- **没有 OA 单号**：`POST /api/workflow/requests` 多一个 `autoSerial`（默认 false）：为 true 时 `serialNumber` 必须空着，服务端在写入事务里编「无OA-申请日期去掉横线-序号」（这一天已用的最大序号加一，至少两位，不设位数上限；手填成同样格式的流水号也避开），同时写进 `serialNumber` 与 `systemSerial`；为 false 时 `serialNumber` 必须填（400）。手填的流水号不能等于别的申请的 `systemSerial`（409）。申请视图多 `systemSerial` 与 `autoSerial`（`serialNumber === systemSerial`，即还没有 OA 单号）。导入确认不变（流水号照旧必填）。
- **修改申请信息**：`PATCH /api/workflow/requests/:id`，body 是整份单据头 `{ serialNumber, autoSerial, department, handler, requestDate, note }`（与录入同样的流水号规则），要 `Idempotency-Key`。补填 OA 流水号 = `autoSerial: false` 加流水号，`systemSerial` 保留（按旧编号仍能搜到）；`autoSerial: true` 换回这张申请的 `systemSerial`，没有就新编一个。申请日期不能晚于这张申请最早一次未撤销的采购或取消（409，消息里写出那一天）；系统编号里的日期不跟着改。什么都没改时不写库、不留审计。审计动作 `WORKFLOW_REQUEST_UPDATE`，详情的 `serialNumber` 是改之前的流水号，`changed` 是 `{ 字段: [旧值, 新值] }`。
- **查询参数**：`GET /api/workflow/requests` 多 `serial`（流水号精确匹配）与 `autoSerial=1`（只要还没有 OA 单号的）；`search` 也匹配 `systemSerial`。
- **部门与人员候选**：`GET /api/workflow/directory` 返回 `departments`（`name`、`uses`、`lastDate`）、`people`（`name`、`department`、`uses`、`lastDate`，同名的人在不同部门各一条）与 `recent`（最近录入的申请里的「部门 · 经办人」，去重后最多 4 组）。来源是全部申请的部门 / 经办人与未撤销发放单的领用部门 / 领用人；次数按申请张数与发放单张数，最近一次按申请日期与业务日期；排序最近一次在前、其次次数。只读，前端每次打开弹窗取一次。
- **AI 助手**：申请查询工具的说明与系统提示里补了「`无OA-` 开头的是没有 OA 单号的申请、`systemSerial` 是原系统编号」，不涉及识别提示词，提示词版本不变。

## 2026-10-16 界面文字审查

方案与记录见 [界面文字审查](copy-review-2026-10.md)。只改界面与报错文字，没有迁移。

- `POST /api/auth/recover`（用恢复码重置密码）现在返回 `{ recoveryCode }`：恢复码本来就会在重置时换新，以前没返回，用户手里就没有可用的恢复码了；登录页会显示一次新码。
- 工作台概览、审计日志的接口不变；审计里的动作名与对象名是前端的显示映射，旧记录照常显示。

## 导入物品整理与复用（2026-10-26）

初始导入草稿（AI、本地 OCR、AI 失败回退）统一整理品名与规格，优先沿用已有物品；已经人工保存的草稿不被重试覆盖。原始识别结果、原文、坐标和附件保留。确认入账再次在同一数据库事务内核对目录，包含本单前面刚创建的物品，不依赖识别时的旧目录。

匹配先查现名和曾用名称，再比较品牌常见中英文写法、空格大小写、规格分项顺序等明确等价的表示；保留型号顺序、容量、颜色、包装、计量单位及无法解释的文字。不同单位不换算，AI 的相似物品建议不直接决定合并。多份档案匹配或同名已有规格而本次缺规格时拒绝确认，所有明细回退，填写完整资料后可重试。

确认快照和审计记下输入与最终采用的物品编号、名称、规格。原有库存、采购、到货及历史单据不更新；同一张申请的重复物理行仍各自保留数量，只共用物品编号。本次无数据库结构迁移，发布前仍按既有流程备份数据和配置。

