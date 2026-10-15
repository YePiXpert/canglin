#!/usr/bin/env bash
# 仓廪首次部署脚本（默认部署到 /opt/canglin）
# 用法：bash deploy/deploy.sh [端口] [部署目录] [--build]；也支持 curl | bash（参数写在 bash -s -- 之后）
# 自定义目录：第二个参数或 CANGLIN_REPO 环境变量
# 镜像从 GHCR 拉取（CI 测试通过后自动构建发布）；拉取失败时报错退出，不回退本地构建。
# --build（位置不限）：用本机源码构建全部三个镜像，这份源码未经 CI 测试，确认需要时再用。
set -euo pipefail

info() { printf '\033[1;34m[部署]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[警告]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 参数：--build 可在任意位置，其余依次是 端口、部署目录 ----------
BUILD=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    --*) die "未知参数：$arg（支持 --build）" ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done
set -- ${POSITIONAL[@]+"${POSITIONAL[@]}"}

REPO_DIR="${2:-${CANGLIN_REPO:-/opt/canglin}}"
WEB_PORT="${1:-8080}"
GHCR_OWNER="yepixpert"

# ---------- 前置检查 ----------
command -v git >/dev/null 2>&1 || die "缺少 git"
if ! command -v docker >/dev/null 2>&1; then
  die "缺少 docker，请先安装：curl -fsSL https://get.docker.com | sh"
fi
if ! docker compose version >/dev/null 2>&1; then
  die "缺少 docker compose 插件（Docker 20.10+ 自带）"
fi
docker info >/dev/null 2>&1 || die "docker 守护进程未运行或当前用户无权限（试试 sudo）"

# ---------- 准备部署目录 ----------
# 源码可以位于 /workspace；部署始终使用显式目录或 /opt 默认目录。
if [ ! -e "$REPO_DIR" ]; then
  info "克隆仓库到 $REPO_DIR …"
  git clone https://github.com/YePiXpert/canglin.git "$REPO_DIR"
fi
[ -d "$REPO_DIR/.git" ] && [ -f "$REPO_DIR/docker-compose.yml" ] \
  || die "部署目录不是有效仓库：$REPO_DIR；请指定空的新路径或已有仓廪仓库"
cd "$REPO_DIR"
info "部署目录：$(pwd)"

# ---------- 生成配置 ----------
if [ ! -f .env ]; then
  if command -v openssl >/dev/null 2>&1; then
    OCR_KEY=$(openssl rand -hex 16)
  else
    OCR_KEY=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  fi
  cat > .env <<EOF
# 部署时自动生成，可按需修改
OCR_API_KEY=$OCR_KEY
COMPOSE_PROJECT_NAME=canglin
WEB_PORT=$WEB_PORT
# 服务器时区：每日 3 点的维护任务和本地日期按它计算
TZ=Asia/Shanghai
EOF
  chmod 600 .env
  info "已生成 .env（含随机 OCR_API_KEY）"
else
  info "复用已有 .env"
  if grep -q '^WEB_PORT=' .env; then
    sed -i "s/^WEB_PORT=.*/WEB_PORT=$WEB_PORT/" .env
  else
    echo "WEB_PORT=$WEB_PORT" >> .env
  fi
fi

# New installations store data beside the deployment configuration.
source deploy/storage.sh
prepare_storage_path
if docker volume inspect canglin_state >/dev/null 2>&1; then
  check_storage_volume
  device=$(docker volume inspect canglin_state --format '{{if .Options}}{{index .Options "device"}}{{end}}')
  [ -n "$device" ] || die "检测到旧数据卷，请先运行 deploy/upgrade.sh 完成备份和迁移"
else
  # The server image runs as uid 1000; unlike managed volumes a bind directory
  # does not inherit /app/state ownership from the image.
  docker run --rm -v "$CANGLIN_DATA_DIR:/state" alpine chown 1000:1000 /state
fi

# ---------- 获取镜像：三个服务必须来自同一源码版本 ----------
SOURCE_REVISION=$(git rev-parse HEAD)
export RELEASE_TAG="sha-$(git rev-parse --short=7 HEAD)"
if [ "$BUILD" = 1 ]; then
  info "按 --build 本地构建全部三个镜像（OCR 镜像较大，约 5-15 分钟）…"
  docker compose build --build-arg "SOURCE_REVISION=$SOURCE_REVISION" web server ocr
else
  # 拉不到镜像不回退本地构建：CI 没通过或还没跑完的提交没有镜像，回退构建等于把没过测试的源码上线。
  info "拉取镜像（ghcr.io/$GHCR_OWNER/canglin-*:$RELEASE_TAG）…"
  if docker compose pull 2>&1; then
    info "镜像拉取完成"
  else
    warn "镜像拉取失败"
    # 能读到 latest 说明镜像包可以访问，缺的只是这个提交的镜像
    if docker manifest inspect "ghcr.io/$GHCR_OWNER/canglin-server:latest" >/dev/null 2>&1; then
      warn "该提交的镜像（$RELEASE_TAG）尚未发布：CI 还在跑或已失败，到 GitHub Actions 查看："
      warn "  https://github.com/YePiXpert/canglin/actions"
      warn "CI 通过后重新运行本命令；CI 失败时，等修复的提交通过后在部署目录执行 git pull --ff-only 再运行"
    else
      warn "GHCR 上还没有可访问的镜像：push 到 GitHub 后 CI 会自动构建（约 10-25 分钟）"
      warn "镜像已发布但为私有包时需要授权拉取，可执行："
      warn "  echo <GitHub PAT(read:packages)> | docker login ghcr.io -u $GHCR_OWNER --password-stdin"
      warn "或到 GitHub → Packages → 对应包 → Settings 改为 Public"
    fi
    die "没有可用的镜像，服务未启动。确认要用本机源码构建（未经 CI 测试）时加 --build 重新运行（curl 一行命令末尾改为 bash -s -- --build，可与端口、目录同用）"
  fi
fi

# Persist the selected release only after all three images are available.
ENV_TMP=$(mktemp .env.release.XXXXXX)
awk '!/^RELEASE_TAG=/' .env > "$ENV_TMP"
printf '\nRELEASE_TAG=%s\n' "$RELEASE_TAG" >> "$ENV_TMP"
chmod 600 "$ENV_TMP"
mv "$ENV_TMP" .env
server_failed() {
  warn "$1，server 最近日志："
  docker compose logs --tail 30 server 2>&1 | sed 's/^/    /'
  docker compose ps 2>&1 | sed 's/^/    /'
  die "请把以上日志发给维护者排查"
}
# web 等 server 健康检查通过才启动；server 起不来时 up 会失败
info "启动服务…"
docker compose up -d --remove-orphans --pull never || server_failed "启动失败"

# ---------- 健康检查 ----------
info "等待服务就绪…"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  [ "$i" = 60 ] && server_failed "健康检查超时"
  sleep 3
done
for i in $(seq 1 30); do
  if docker compose exec -T ocr python -c 'import os,urllib.request; urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8000/ready",headers={"X-API-Key":os.environ["OCR_API_KEY"]}),timeout=30).read()' >/dev/null 2>&1; then
    info "OCR 解析服务正常（模型已加载）"
    break
  fi
  [ "$i" = 30 ] && die "OCR 就绪检查失败，部署未通过；检查模型与资源限制"
  sleep 3
done

info "部署完成 ✓  访问 http://<服务器IP>:${WEB_PORT} 设置管理员密码"
info "常用命令："
info "  docker compose logs -f          # 看日志"
info "  docker compose up -d server     # 改了 .env 后重建 API 容器（restart 不会读新的 .env）"
info "  curl -fsSL https://raw.githubusercontent.com/YePiXpert/canglin/main/deploy/upgrade.sh | bash"
info "                                  # 一行升级（任意目录；默认 /opt/canglin；其他目录用 bash -s -- <目录> 指定）"
