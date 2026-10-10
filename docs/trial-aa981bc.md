# aa981bc 隔离试用

候选业务版本固定为 `aa981bc8ff1f4228000fa92d1a3b8472da18ade9`，对应 [已成功完成的 CI](https://github.com/YePiXpert/procure-lite/actions/runs/38026041591) 和 [部署脚本检查](https://github.com/YePiXpert/procure-lite/actions/runs/38026041597)。三个镜像摘要已与 CI 推送日志和 GHCR 清单核对，镜像的 `org.opencontainers.image.revision` 标签均为该完整提交。

## 环境边界

| 项目 | 固定值 |
| --- | --- |
| Compose 项目 | `procure-lite-trial-aa981bc` |
| 数据卷 | `procure-lite-trial-aa981bc_trial-state`，独立 SQLite、原件、设置及会话 |
| 网络 | 独立项目网络，API/OCR 不发布主机端口 |
| 入口 | 服务器本机 `http://127.0.0.1:18080` |
| OCR 资源 | 2 CPU、4GB，单活动解析、2 推理线程 |
| 其他资源 | API 1 CPU/1GB，Web 0.25 CPU/128MB |
| 本机配置 | 仓库下 `state/trial-aa981bc/env`，权限 600，独立随机 OCR 密钥 |
| AI 初始状态 | 未配置、关闭 |
| 生命周期 | 不随主机重启自动启动；Watchtower 自动更新关闭；停止后保留数据 |

三个镜像以不可变摘要固定在 `deploy/compose.trial.yml`，`trial.sh` 在启动前校验三个镜像的源码标签。配置目录可通过 `PROCURE_TRIAL_DIR` 指定；它只改变配置和检查记录位置，项目名和数据卷仍固定为本候选版本。

| 镜像 | 摘要 |
| --- | --- |
| server | `sha256:b675ab44ba0c0905bf128a7bd4e36ddf8b0486a9af8cf7e5bb3718639af7508b` |
| web | `sha256:9efac7be6a9bf5342942fb94d98eabd11079aca80a38035c387f2f8e20379903` |
| ocr | `sha256:05cbebb3e5f1a9f493b705c4e6f2f1b76b3439feeaa21938b18969ec4e7a7d53` |

## 启动与访问

需要 Docker Compose、curl、openssl 和可访问 GHCR 的网络。在这份仓库中运行：

```bash
bash deploy/trial.sh up
bash deploy/trial.sh check
bash deploy/trial.sh status
bash deploy/trial.sh logs
```

`check` 检查 Web 入口、API/数据库，以及 API → OCR 鉴权和模型就绪。首次访问时设置独立管理员密码。

如果历史 `b10744b` 试用环境仍在运行，先在 [历史工作区](trial-b10744b.md) 执行旧版 `trial.sh stop`，释放本机端口 `18080`。新版使用新数据卷，旧试用数据仍保留。

从自己的电脑访问远端主机时，建立 SSH 隧道后在浏览器打开 `http://127.0.0.1:18080`：

```bash
ssh -N -L 18080:127.0.0.1:18080 用户名@VPS地址
```

## 可重复验证

```bash
python3 -m unittest discover -s deploy/tests -v
bash deploy/trial.sh smoke
```

`smoke` 从候选提交读取 `deploy/tests/smoke-api.cjs`，在断网且带匿名临时数据卷的 API 容器中检查空库迁移、人工导入确认、原件备份恢复、恢复后会话失效。临时容器和卷自动清理，结果保存在本候选配置目录的 `smoke.json`；固定合成密码只用于该临时容器。`up` 的就绪结果保存在 `readiness.json`。

本候选的 CI 已完成前后端构建、类型检查、lint、单元测试、浏览器测试及 OCR 真实模型离线测试。实际试用环境的就绪检查、真实单据效果验收和历史数据升级/回退演练仍需分别执行；[旧版试用记录](trial-b10744b.md) 的运行证据只属于旧版。

2026-10-10 本轮已拉取上述三个固定摘要的镜像，并通过以下本机验证：

- Shell 语法检查、部署脚本 16 项测试、评测脚本 2 项测试。
- 共享包构建、前后端类型检查、lint、服务端 142 项及前端 109 项单元测试。
- 使用临时配置目录运行 `trial.sh smoke`：空库启动、人工导入确认、原件备份恢复及恢复后会话失效全部通过，临时容器、匿名卷及配置目录已清理。
- 冒烟前后正式 Web、API、OCR 容器的 ID、镜像 ID 和启动时间一致。

## 停止与清理

```bash
# 停止试用容器和网络，保留试用数据及配置
bash deploy/trial.sh stop
# 再次启动使用同一候选镜像和试用数据
bash deploy/trial.sh up
```

确认本候选试用数据不再需要后，先执行 `stop`，再删除本候选的数据卷：

```bash
docker volume rm procure-lite-trial-aa981bc_trial-state
```

配置目录内的检查记录可留存；`env` 密钥文件不提交到 Git。试用环境的初始化、停止和清理只针对上述候选项目。
