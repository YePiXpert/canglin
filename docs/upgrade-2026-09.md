# 按量采购工作流、原件识别与升级

本文记录 2026-09-30 重构后的业务接口、原件识别与部署维护。需求已经确认，见 [重构需求](./rebuild-requirements.md)。技术栈仍为 Vue、Nest/Fastify、SQLite 与 Python OCR；主导航为工作台、申请、库存与领用、报表、系统设置。

新主流程使用独立的申请、业务单据、库存余额和不可覆盖的库存流水，不推算或伪造历史采购、到货事实。旧表与旧路由曾保留兼容，已由 2026-10-08 的迁移删除（见[删除旧台账与加固](#2026-10-08-删除旧台账与加固)）。本次开发不清空既有目录；在新测试库执行迁移即可使用新主流程。

## 实现与默认值

| 范围 | 行为 |
| --- | --- |
| 草稿 | 未知数量为 null，申请日期不补当天；独立行、稳定 lineId、逐页来源、乐观版本号、修改历史 |
| 确认 | 严格数量/价格校验；保留原件物理行，含同名行；规格和单位参与物品身份；任务只能确认一次 |
| 原件 | 内容哈希提示重复，可直接打开已有任务，用户明确继续才创建新任务；未确认原件保留 30 天，上传及每 6 小时清理到期任务；确认后的来源长期保留 |
| OCR | Python 3.11、PaddleOCR 3.7.0、PaddlePaddle 3.3.1、PP-OCRv6 medium；方向识别开启，去畸变关闭 |
| OCR 资源 | 一个进程/推理实例/活动解析，2 CPU、4GB 内存、2 推理线程，页面最大边 2560；30MB、自动最多 30 页 |
| AI | Responses，第三方 baseURL 可配置；原件识别优先，本地 OCR 备用；能力按实际请求检测 |
| 请求 | 智能导入并发 1，单页输出最多 4096 tokens，120 秒；429/500/502/503 最多重试一次，不确定超时不自动重发 |
| 用量 | 输入/输出 tokens、模型、耗时、请求标识；缺少用量为未知，未配置价格不计算费用 |
| 库存 | 品名、规格、单位构成物品身份；收货待处理与库存分开；直发余量不自动入库 |
| 写防重 | 申请、采购、收货、入库、发放、退回、取消、调整及撤销等写操作必须带 Idempotency-Key；同事务持久化请求指纹及结果 |

模型文件在构建期预下载，以 `apps/ocr/models.sha256` 校验；依赖来自 `apps/ocr/requirements.lock`。禁止运行时补下载作为正常启动流程。真实 CPU 测试发现当前 oneDNN 路径不兼容，已明确关闭 MKLDNN；更新此设置需重跑真实容器测试。

首次识别结果、AI 重试建议和人工草稿分开保存。图片优先直接识别原始字节；PDF 仅依赖 Python 做页数检查和渲染，AI 成功时无需启动 OCR 模型。失败页才回退本地 OCR。后台迟到结果不能覆盖人工编辑；重试保留历史。AI 只有页级定位，不会伪造坐标。原件文本只作为数据，自动识别不携带业务写工具；问答仍使用只读工具白名单、参数校验和六轮工具上限。

## 配置第三方 Responses

1. 设置 `LLM_BASE_URL`、`LLM_MODEL` 和服务器 `LLM_API_KEY`，或将 secret 文件挂载到服务器并设置 `LLM_API_KEY_FILE`。不要把 secret 放到 uploads。Compose 使用 secret 文件时用 `docker-compose.override.yml` 增加只读挂载和环境变量（示例见下）。该文件不提交到仓库，升级保留它。
2. 服务器密钥配置一次后，设置页显示“服务器已配置 Key，无需填写”。已有密钥时自动从已保存服务的 `GET /models` 获取模型，只需选择一个模型，识别、问答和搜索共用；旧配置中的分任务模型不再生效，曾单独指定任务模型时需重新检测能力。服务地址或密钥改动后先保存，再获取列表；服务商不支持列表时可手动填写。列表不代表 Responses 能力，也不会自动更改模型或启用 AI。旧数据库密钥兼容；服务器密钥优先，界面及日志不返回明文。
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
      - /etc/canglin/llm_api_key:/run/secrets/llm_api_key:ro
```

`store:false` 只是请求参数，不代表第三方零留存。模型名称不代表能力。设置页不再提供计价和预算项；未配置时只记录用量，预算默认关闭。历史单价与预算记录保留兼容，币种由服务商决定。月预算按已记录的导入估算费用停止后续请求，单页请求可能跨过阈值；它不是第三方账单硬限额。问答和搜索不计入导入预算。

识别成功与费用记账分开：截断、拒绝、JSON/Schema 错误只要带有可信用量，就按该次配置单价估算费用。发出后没有用量的失败调用费用为未知，启用预算时阻止后续自动请求；在页面渲染等发送前步骤失败的调用标记为 `NOT_SENT`，费用为 0，不占预算。旧记录缺少费用依据时仍保持未知，不使用当前单价补造历史账单。预算拦截只结束 AI 阶段，保留已完成的识别草稿，允许明确人工核对后继续入账。

## API 与数据兼容

- `POST /api/imports/upload`：multipart 单文件；内容与已有任务相同时只返回 `{duplicateTaskId}`、不创建任务：优先指向最新的未确认任务，都已确认时指向最近确认的那个；带 `?continueDuplicate=true` 才新建。
- `GET /api/imports/tasks?confirmed=false|true&page=1&pageSize=10`：只读任务列表，只按 `confirmedAt` 筛选（`false` 为未确认入账，包括本地识别已完成的任务），按上传时间倒序；`page` ≥ 1，`pageSize` 1–50（默认 10），参数不合法返回 400。返回 `{tasks,total,page,pageSize}`，每行只有 `id`、`filename`、`createdAt`、`finishedAt`、`status`、`aiStatus`、`confirmed`、`confirmedAt`、`originalAvailable`，新流程已确认任务另带 `requestId`；不返回存储路径、识别结果、草稿、AI 结果或确认快照，也不触发识别、重试或清理。
- `GET /api/imports/tasks/:id`：阶段状态、草稿版本、逐页结果、`reviewPages`（页码、原因、人工核对状态）、建议及调用记录。任务不存在（编号有误或已被清理）时返回 404；导入页据此显示说明、停止轮询，不自动新建任务。
- `PUT .../:id/draft`：`{version,draft}`；旧版本返回 409，不覆盖当前编辑。
- `GET .../:id/revisions`：本地识别与人工草稿版本记录。
- `GET .../:id/original`、`GET .../:id/pages/:page`：鉴权读取，服务端路径不对外暴露。
- `POST .../:id/retry`：`{stage:"local"|"ai",pages?:number[]}`；`POST .../:id/cancel` 取消当前代次。
- `POST /api/workflow/imports/confirm`：人工确认后的最终值、taskId、version，以及 Idempotency-Key 请求头；同一事务校验任务/页核对/版本、建立申请与原件关联、标记确认并记录审计。旧 `POST /api/imports/confirm` 已随旧台账删除。
- `POST /api/ai/capabilities`：检测 Responses 的实际能力。
- OCR `/health` 为进程存活；`/ready` 要求加载模型并完成小样例推理。

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
- **导入只记申请事实**：导入页不再收集单价与采购链接，成交价和链接在登记采购时填写；`workflowImportConfirmSchema` 去掉 `supplierId`、`operationId`（操作编号只走 `Idempotency-Key` 请求头），草稿契约去掉 `supplierId`、`duplicateAction`。OCR/AI 读到的单价字段仍留在原始识别结果里，仅供核对。
- **语义搜索**：开启后 `/api/workflow/requests`、`documents`、`stock` 的 `search` 用词表内的同义词扩展品名匹配，词表来自申请明细品名与物品目录。
- **验证口径**：`deploy/tests/smoke-api.cjs` 改走新接口（导入确认建申请 → 备份 → 取消一行 → 恢复 → 校验申请与原件）；CI 增加前后端 lint；本地验证数字见 README。

## 2026-10-10 改名为仓廪并发布 v2.0.0

项目改名为「仓廪」（技术名 `canglin`），版本从 v2.0.0 重新开始。只有一位使用者，旧实例由升级脚本一次迁移，不保留旧名兼容期。业务数据不变，数据库文件名仍为 `procure.db`（procure 是业务词，改名会多一次数据迁移）。

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

**自动迁移**：先在 GitHub 完成改名，等 CI 推送 `canglin-*` 镜像（新包默认私有，按 README 设为 Public 或 `docker login`；拉取失败时脚本回退本地构建），再在 VPS 上执行新的一行升级命令（不要改跑首次部署脚本，它发现 `/opt/procure-lite` 时会拒绝在 `/opt/canglin` 另起一套空系统）。升级脚本先完成全部前置检查（docker、`.env`、数据卷、已跟踪文件改动），任一项失败都不做改动；之后依次：

1. **目录**：使用默认目录且 `/opt/canglin` 不存在、`/opt/procure-lite` 存在时，执行 `mv /opt/procure-lite /opt/canglin`（`.env`、override 与 `pre-upgrade-backups/` 随之移动）；显式指定的其他目录不做猜测。Git 远端仍指向 `YePiXpert/procure-lite` 时改为 `YePiXpert/canglin`。
2. **记录旧镜像**：旧项目 `procure-lite` 还有容器时，从它记录三个旧镜像并打 `canglin-rollback-*` 标签。
3. **拉代码后**：确认 `docker-compose.yml` 已是 `name: canglin`（否则在停机前退出，例如误用 `--no-pull`）；把 `.env` 的 `COMPOSE_PROJECT_NAME=procure-lite` 改为 `canglin`，因为它优先于 compose 文件的 `name:`，不改会以旧项目名新建一个空卷；再核对 `docker compose config` 解析出的项目和数据卷确为 `canglin` / `canglin_state`。
4. **获取新镜像**（不停机）。
5. **停机**：`docker compose down` 后，停止带 `com.docker.compose.project=procure-lite` 标签的旧容器（先不删除）。
6. **复制数据卷**：`canglin_state` 不存在而旧卷存在时，创建 `canglin_state`，用一次性 alpine 容器只读挂载旧卷，执行 `cp -a` 并 `chown -R 1000:1000`。复制失败会删除不完整的新卷后退出：旧卷和已停止的旧容器都还在，可 `docker start` 恢复旧服务，或排除原因后重跑。
7. **备份**：照常把 `canglin_state` 打包为 `release-*/state.tar.gz`，然后对数据卷执行 `chown -R 1000:1000`（每次升级都做，回退到 root 运行的旧版期间写入的文件也会交还给 node）。
8. **启动**：删除旧项目的容器（释放端口），`docker compose up` 启动新版本。

各步骤都按当前状态判断：目录已迁移、`.env` 已改名、`canglin_state` 已存在、没有旧项目容器时对应步骤跳过，所以停机前任何一步失败都可以直接重跑，迁移完成后的升级与普通升级相同。复制若被强制中断（如断电），`canglin_state` 可能不完整，重跑前先 `docker volume rm canglin_state`，脚本会从旧卷重新复制。旧卷 `procure-lite_procure-state` 始终保留，确认新版本数据完整后可自行 `docker volume rm procure-lite_procure-state`；遗留网络 `procure-lite_default` 和旧的 `procure-lite-rollback-*` 标签也可在不再需要回退时清理。cron、反向代理等引用 `/opt/procure-lite` 的外部配置需自行更新；override 中挂载的宿主机文件（如 `/etc/procure-lite/llm_api_key`）未被移动，原路径仍然有效。

**回退**：`rollback.sh` 固定使用项目 `canglin` 和数据卷 `canglin_state`。回退到改名前的版本时，旧配置的卷键是 `procure-state`，脚本会在该 release 的 `old-images.yml` 末尾追加一次 `volumes: procure-state: name: canglin_state`，旧版继续使用当前数据卷；回退后的手工管理命令见下文（`-p canglin`）。

**容器加固**：

- **server 以 node 用户运行**（uid 1000）：运行阶段用 `COPY --chown=node:node` 复制产物，不在事后 `chown -R /app`（那样会把整个 node_modules 再复制成一层，每个版本都要重新下载）；`/app/state` 归 node，新建的数据卷首次挂载时继承该属主，已有数据卷由升级脚本修正。入口脚本在数据目录或 `procure.db` 不可写时直接报错并给出 chown 命令；`npx prisma migrate deploy` 与 `node dist/main.js` 均无需 root。
- **server 健康检查**：`GET http://127.0.0.1:3000/api/auth/status`（全局前缀 `api` 下的公开路由，会查询数据库），间隔 30 秒、超时 5 秒、启动宽限 40 秒、重试 3 次。web 用 `depends_on: server: {condition: service_healthy}` 等 server 健康后再启动，因此 `docker compose up` 要等首次检查通过（约 30 秒）才返回；server 起不来时 `up` 直接失败，部署脚本打印日志，升级脚本打印回退命令。
- **web 健康检查**：`wget -qO- http://127.0.0.1/`（nginx:alpine 自带 busybox wget），只检查静态页。
- server 对 ocr 仍是普通 `depends_on`：OCR 加载模型慢，不让 server 等 OCR 健康；OCR 就绪仍由部署和升级脚本单独检查。
- **OCR 仍以 root 运行**：PaddleOCR/PaddleX 在构建期把模型下载到 `/root/.paddlex/official_models` 并按 `models.sha256` 校验，运行时也使用主目录下的缓存和配置。改用户需要同时迁移这些路径、权限和校验步骤并重新做真实模型验收，本次不改。

**版本与标签**：旧的 v1.2.x 标签属于重写前的旧代码库，已从仓库删除，版本从 v2.0.0 重新开始，变更见 [CHANGELOG](../CHANGELOG.md)。早先拉取到本机的旧标签不会被 `git fetch --tags` 自动删除，不影响升级。

**试用环境**：`deploy/trial.sh` 的项目名改为 `canglin-trial-aa981bc`，数据卷随之变为 `canglin-trial-aa981bc_trial-state`（旧项目名下的试用数据不再被使用）。`deploy/compose.trial.yml` 的三个 image 行仍钉在候选版本 `aa981bc` 的旧名镜像摘要（`procure-lite-*`，仍在 GHCR 上）；CI 推送 `canglin-*` 新镜像后再重新钉住候选版本和摘要。若曾用旧项目名启动过试用，先停掉 `procure-lite-trial-aa981bc` 项目的容器，以免占用 18080 端口。

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
docker build -f deploy/Dockerfile.ocr -t canglin-ocr:runtime-test .
docker build -f deploy/Dockerfile.ocr-test -t canglin-ocr:test .
docker run --rm --network none --cpus 2 --memory 4g canglin-ocr:test
docker run --rm --network none --cpus 2 --memory 4g canglin-ocr:test python -m tests.smoke_engine
```

浏览器测试启动独立临时 SQLite 和真实 API，OCR/AI 使用明确的合成替身；不访问生产数据。协议错误测试另外覆盖 Responses 请求与异常。真实 OCR 容器验收命令在断网和资源限制下运行模型；实际执行状态须查对应验收记录，合成测试通过不代表本次已完成真实模型验收。

## 备份、恢复与回退

新业务备份包含数据库、uploads、格式版本、schema 指纹和逐文件 SHA256 清单，不包含外部 secret。维护门禁拒绝新请求并排空已开始的任务，保证引用与文件一致。恢复先在临时目录检查数据库、外键、文件及哈希；旧备份在隔离副本执行迁移。替换时保留旧数据库与原件目录，并写入持久恢复日志。

中断恢复在 Prisma 打开数据库前执行；容器入口也在迁移前执行恢复。WAL/SHM 在切换时处理，连接设置重新应用，旧会话失效，配置和定时任务刷新。数据库与文件切换失败会恢复完整旧状态。

生产发布是独立步骤：本地验证与测试不运行部署脚本、不修改现网。

```sh
# 构建或拉取同一源码标签的全部三个镜像；OCR 失败必须失败退出
bash deploy/upgrade.sh /opt/canglin --build
# 回退必须同时恢复旧数据和固定的旧镜像
bash deploy/rollback.sh /opt/canglin /opt/canglin/pre-upgrade-backups/release-TIMESTAMP
```

升级脚本先检查旧数据卷、旧镜像和备份工具，拉取或构建三个新镜像后才停机。仓库更新使用 `git merge --ff-only origin/main`，已跟踪文件有改动时退出，不再清理本机未跟踪的配置。成功获取镜像后将源码标签持久化为 `.env` 中的 `RELEASE_TAG`；首次部署同样如此。日常 `docker compose up` 沿用该版本，不会自行切换到 latest。默认项目名和数据卷为 `canglin` / `canglin_state`（改名前的旧实例由升级脚本迁移，见[改名为仓廪](#2026-10-10-改名为仓廪并发布-v200)），自定义项目名需单独调整部署流程。

发布记录包含旧/新源码、迁移校验、三个镜像 ID、OCR 版本及模型就绪结果。自动回退点不会清理，稳定后由管理员归档。不要仅回退代码而继续使用迁移后的数据库。旧版服务器凭据仍由部署环境管理，应用不会自动替换服务商或密钥。

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

见 [验收记录](./upgrade-acceptance.md)。真实第三方地址/密钥、30—50 份脱敏业务单据以及生产数据库未提供。模拟测试和合成样例不能代替第三方能力、业务准确率、真实页面 P95/持续内存、历史精度差异或目标部署环境回退演练。因此发布验收保持未通过。

协议参考：[Responses 迁移](https://developers.openai.com/api/docs/guides/migrate-to-responses)、[结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)、[无状态推理条目回传](https://developers.openai.com/api/docs/guides/reasoning)。使用 SDK 的 `toResponseInputItems` 保留可回传条目及不透明的加密推理内容。
