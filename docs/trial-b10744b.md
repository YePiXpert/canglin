# b10744b 隔离试用

> 适用范围：本文只适用于候选版本 `b10744b`，是那次隔离试用的操作记录，不是对当前 `main` 的验收。之后的改动（如导入草稿找回、库存页合计移除）不在该试用镜像里。当前 `deploy/compose.trial.yml` 和 `deploy/trial.sh` 已切换到 `aa981bc`，操作说明见 [当前试用说明](trial-aa981bc.md)。本文中的命令和摘要只适用于历史配置；如需复现，先通过 `git worktree add --detach ../procure-lite-trial-b10744b aa981bc8ff1f4228000fa92d1a3b8472da18ade9` 创建历史工作区，并在该目录中执行下文命令。

候选业务版本固定为 `b10744b109e8904ef4d443b39741b47051db8600`，对应 [已成功完成的 CI](https://github.com/YePiXpert/procure-lite/actions/runs/36306254569)。本轮只提供隔离试用的运维文件，不改应用、导航、模型参数或正式部署脚本。

## 环境边界

| 项目 | 固定值 |
| --- | --- |
| Compose 项目 | `procure-lite-trial-b10744b` |
| 数据卷 | `procure-lite-trial-b10744b_trial-state`，独立 SQLite、原件、设置及会话 |
| 网络 | 独立项目网络，API/OCR 不发布主机端口 |
| 入口 | 服务器本机 `http://127.0.0.1:18080` |
| OCR 资源 | 2 CPU、4GB，单活动解析、2 推理线程 |
| 其他资源 | API 1 CPU/1GB，Web 0.25 CPU/128MB |
| 本机配置 | 仓库下 `state/trial-b10744b/env`，权限 600，独立随机 OCR 密钥 |
| AI 初始状态 | 未配置、关闭；不读取正式 `.env`、本机 override 或正式设置数据库 |
| 生命周期 | 不随主机重启自动启动；Watchtower 自动更新关闭；停止后保留数据 |

三个镜像以不可变摘要固定在 `deploy/compose.trial.yml`，脚本还校验镜像源码标签等于候选提交。不拉 latest、不构建当前源码、不使用生产配置作为基础层。配置目录可通过 `PROCURE_TRIAL_DIR` 指定；它只改变配置和检查记录位置，不改变试用项目名或数据卷。

| 镜像 | 摘要 |
| --- | --- |
| server | `sha256:3b89915e58ef56bb9c0501c8f8273c3bf7cae05cfdb9c03bca58e933110a147d` |
| web | `sha256:b19d1ae1fce05e1486305518150ea0b531b4858034d3d114aecca69b08e3d4c2` |
| ocr | `sha256:6bd11b130f02a6bc90ca875cecfdbd80ab5662f3ec52b40bad789008f2753c3f` |

## 启动与访问

需要 Docker Compose、curl、openssl 和可访问 GHCR 的网络。在这份仓库中运行，脚本不接受生产部署目录：

```bash
bash deploy/trial.sh up
bash deploy/trial.sh check
bash deploy/trial.sh status
bash deploy/trial.sh logs
```

`check` 检查 Web 入口、API/数据库，以及真实的 API → OCR 鉴权和模型就绪。密钥不打印到输出。首次启动保留空白台账，由试用者在页面设置独立管理员密码。

从自己的电脑访问远端主机时，先建立 SSH 隧道：

```bash
ssh -N -L 18080:127.0.0.1:18080 用户名@VPS地址
```

然后在浏览器打开 `http://127.0.0.1:18080`。建议使用独立浏览器配置，避免与正式环境的登录状态混用。此轮没有新增公网入口、域名、反向代理或防火墙规则。

## 本轮已执行的隔离检查

- 按上述三个摘要拉取实际发布镜像，并验证它们的源码标签均为 `b10744b`。
- 实际启动三容器，API/数据库、Web 入口及 API → PaddleOCR 3.7.0 / PP-OCRv6 medium 就绪通过。
- 新试用卷保持空白，未配置第三方密钥或写入试验单据。
- 在另一个断网、独立临时卷的候选 API 容器中，合成人工导入、原件备份恢复、恢复后会话失效通过；临时容器和卷自动清理。
- 启动前后比对正式采购三个容器的 ID、镜像 ID 与启动时间，没有变化。

可重复运行上述临时冒烟，**不会向正在试用的数据库写入记录**：

```bash
bash deploy/trial.sh smoke
```

冒烟脚本取自候选提交自身的 `deploy/tests/smoke-api.cjs`（`git show b10744b:deploy/tests/smoke-api.cjs`），与候选镜像的接口一致；当前 `main` 的同名脚本已改走新的 `/api/workflow` 接口，不适用于该镜像。其固定合成密码只用于自动销毁的断网临时容器；正式试用环境没有预设密码。结果保存在配置目录的 `readiness.json`、`smoke.json`。这些证据只证明环境与恢复链路可运行，不证明真实单据识别效果，也不是完整升级/回退演练。

## 后续试用顺序

1. 独立设置管理员密码，保持 AI 关闭，先使用少量脱敏单据跑通上传、人工校对、确认、采购与库存流程，核对原件关联。
2. 获得真实第三方配置后，仅在试用设置页配置服务并执行能力检测，再启用自动 GPT。检查失败页人工放行、用量及预算行为。
3. 记录每份单据的漏行、数字错误、人工修改次数、核对耗时和实际请求信息。少量冒烟只用于发现问题，不能替代 30—50 份样本及保留测试集的效果验收。
4. 另行安排历史数据库精度检查和目标环境升级/完整回退演练。完成前保留生产发布阻断。

不导入正式数据库或正式备份作为日常试用数据；需要验证历史数据时另建隔离副本。本轮没有真实服务和样本，因此以上业务验收仍为待外部输入。

## 停止与清理

```bash
# 停止并移除试用容器和网络，保留试用数据及配置
bash deploy/trial.sh stop
# 再次启动仍使用同一候选镜像和试用数据
bash deploy/trial.sh up
```

确认试用数据不再需要、已导出必要证据后，先执行 `stop`，再明确删除这个试用卷：

```bash
docker volume rm procure-lite-trial-b10744b_trial-state
```

不要删除 `procure-lite_procure-state`，它属于正式环境。配置目录内的检查记录可留存；不要把 `env` 密钥文件提交到 Git。`trial.sh` 不调用正式升级/回退脚本，也不提供自动删除正式数据的操作。
