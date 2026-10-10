#!/bin/sh
# server 容器入口：完成中断恢复 → 增量迁移 → 启动 API
# 用脚本文件而非 Dockerfile CMD，绕开 JSON/exec-form 的转义解析坑
set -e
cd /app/apps/server

# 数据目录默认值与应用保持一致（应用默认是 cwd/state，容器里必须显式指向挂载卷）
export DATA_DIR="${DATA_DIR:-/app/state}"
export DATABASE_URL="${DATABASE_URL:-file:${DATA_DIR}/canglin.db}"

# 镜像以 node 用户运行：数据卷仍归 root 时直接说明原因，而不是在恢复或迁移中途报权限错误
state_dir="${DATA_DIR:-/app/state}"
if [ ! -w "$state_dir" ] || { [ -e "$state_dir/canglin.db" ] && [ ! -w "$state_dir/canglin.db" ]; }; then
  echo "数据目录 $state_dir 对当前用户（uid $(id -u)）不可写；server 以 node 用户（uid 1000）运行。" >&2
  echo "请把数据卷改归 uid 1000，例如：docker run --rm -v canglin_state:/state alpine chown -R 1000:1000 /state" >&2
  exit 1
fi

node -e 'require("./dist/system/restore-files").recoverRestore(process.env.DATA_DIR || "/app/state")'
npx prisma migrate deploy

exec node dist/main.js
