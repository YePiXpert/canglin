#!/usr/bin/env bash
# 仓廪升级脚本：拉代码 → 拉新镜像 → 停机备份数据 → 升级 → 健康检查
# 用法（任意目录均可执行）：
#   bash deploy/upgrade.sh             # 默认操作 /opt/canglin
#   curl -fsSL https://raw.githubusercontent.com/YePiXpert/canglin/main/deploy/upgrade.sh | bash
#                                      # 一行升级：默认 /opt/canglin
#   curl -fsSL …/upgrade.sh | bash -s -- /path/to/repo
#                                      # 仓库在别处时指定目录（或用环境变量 CANGLIN_REPO）
# 可选参数：--build 本地构建三个镜像；--full 兼容旧参数；--no-pull 跳过 git pull
set -euo pipefail

info() { printf '\033[1;34m[升级]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[警告]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 定位部署目录 ----------
# 优先级：首个非 -- 参数 > CANGLIN_REPO > /opt/canglin。
# 不根据脚本位置或当前工作目录选择仓库，以免覆盖 /workspace 开发副本。
REPO_DIR="${CANGLIN_REPO:-/opt/canglin}"
if [ $# -gt 0 ] && [ "${1:0:2}" != "--" ]; then REPO_DIR="$1"; shift; fi
[ -d "$REPO_DIR" ] || die "部署目录不存在：$REPO_DIR；请先部署，或用参数 / CANGLIN_REPO 指定已有目录"
[ -d "$REPO_DIR/.git" ] && [ -f "$REPO_DIR/docker-compose.yml" ] \
  || die "部署目录不是有效仓库：$REPO_DIR"
cd "$REPO_DIR"
info "部署目录：$(pwd)"

BUILD=0
GIT_PULL=1
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    --full) : ;;
    --no-pull) GIT_PULL=0 ;;
    *) echo "未知参数：$arg（支持 --build / --full / --no-pull）" >&2; exit 1 ;;
  esac
done

command -v docker >/dev/null 2>&1 || die "缺少 docker"
docker compose version >/dev/null 2>&1 || die "缺少 docker compose 插件"
[ -f .env ] || die "未找到 .env（请先执行 deploy/deploy.sh）"
# Fixed single-machine deployment; reject a missing volume before stopping anything.
PROJECT="canglin"
VOLUME="canglin_state"
docker volume inspect "$VOLUME" >/dev/null 2>&1 || die "找不到数据卷 $VOLUME；服务未停止"
docker image inspect alpine >/dev/null 2>&1 || docker pull alpine
if [ "$GIT_PULL" = 1 ]; then
  git diff --quiet && git diff --cached --quiet || die "部署仓库有已跟踪文件的本机改动；请先保存改动，升级不会覆盖它们"
fi

OLD_COMMIT=$(git rev-parse HEAD)
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="pre-upgrade-backups"
RELEASE_DIR="$BACKUP_DIR/release-$STAMP"
mkdir -p "$RELEASE_DIR"
chmod 700 "$BACKUP_DIR" "$RELEASE_DIR"
cp docker-compose.yml "$RELEASE_DIR/old-compose.yml"
printf 'services:\n' > "$RELEASE_DIR/old-images.yml"
printf 'old_source=%s\n' "$OLD_COMMIT" > "$RELEASE_DIR/release.txt"
# 三个服务都没有容器（例如已手工停机）时没有可回退的旧镜像：警告后继续，rollback.sh 会拒绝这个发布目录。
# 只有部分服务缺容器说明部署异常，在停机前退出。
CURRENT_IMAGES=$(docker compose -p "$PROJECT" images -q)
if [ -z "$CURRENT_IMAGES" ]; then
  warn "没有运行中的容器，跳过回退点记录"
else
  for service in web server ocr; do
    old_image=$(docker compose -p "$PROJECT" images -q "$service" | head -n 1)
    [ -n "$old_image" ] || die "无法记录 $service 的旧镜像（其他服务仍有容器）；请先恢复当前部署，服务未停止"
    rollback_tag="canglin-rollback-$service:$STAMP"
    docker tag "$old_image" "$rollback_tag"
    printf '  %s:\n    image: %s\n' "$service" "$rollback_tag" >> "$RELEASE_DIR/old-images.yml"
    printf 'old_%s=%s\n' "$service" "$old_image" >> "$RELEASE_DIR/release.txt"
  done
fi

# ---------- 拉取新代码 ----------
if [ "$GIT_PULL" = 1 ]; then
  info "拉取最新代码…"
  git fetch origin main --tags
  git merge --ff-only origin/main
fi
source deploy/storage.sh
prepare_storage_path
check_storage_volume || die "数据目录检查失败；服务未停止"
NEW_COMMIT=$(git rev-parse HEAD)
export RELEASE_TAG="sha-$(git rev-parse --short=7 HEAD)"
printf 'new_source=%s\nrelease_tag=%s\nocr_model=PP-OCRv6_medium\n' "$NEW_COMMIT" "$RELEASE_TAG" >> "$RELEASE_DIR/release.txt"
cp docker-compose.yml "$RELEASE_DIR/new-compose.yml"
find apps/server/prisma/migrations -name migration.sql -exec sha256sum {} \; > "$RELEASE_DIR/migrations.sha256"
sha256sum apps/ocr/models.sha256 apps/ocr/requirements.lock >> "$RELEASE_DIR/release.txt"
info "代码版本：$OLD_COMMIT → $NEW_COMMIT"
# 以 Compose 实际解析结果为准（.env 或 shell 中的 COMPOSE_PROJECT_NAME 会覆盖 compose 文件的 name:），不对就在停机前退出。
RESOLVED=$(docker compose config)
case "$RESOLVED" in
  "name: $PROJECT"$'\n'*"name: $VOLUME"*) ;;
  *) die "Compose 解析出的项目或数据卷不是 $PROJECT / $VOLUME（检查 .env 与环境变量 COMPOSE_PROJECT_NAME）；服务未停止" ;;
esac

# ---------- 获取镜像（不停机） ----------
if [ "$BUILD" = 1 ]; then
  SERVICES="web server ocr"
  info "本地构建镜像：$SERVICES …"
  docker compose build --build-arg "SOURCE_REVISION=$NEW_COMMIT" $SERVICES
else
  info "拉取最新镜像（未变更的层不会重复下载）…"
  if ! docker compose pull; then
    warn "镜像拉取失败，回退本地构建全部三个镜像"
    docker compose build --build-arg "SOURCE_REVISION=$NEW_COMMIT" web server ocr
  fi
fi

# ---------- 停机 + 备份 ----------
info "停止服务并备份当前数据…"
docker compose down --remove-orphans

docker run --rm \
  -v "$VOLUME:/state:ro" \
  -v "$(pwd)/$RELEASE_DIR:/backup" \
  alpine tar czf "/backup/state.tar.gz" -C /state .
docker run --rm -v "$(pwd)/$RELEASE_DIR:/backup:ro" alpine tar tzf /backup/state.tar.gz >/dev/null
info "已备份：$RELEASE_DIR/state.tar.gz（数据库 + 附件；外部 secret 保持外部管理）"

# The stopped volume backup is complete; migrate legacy Docker-managed storage.
migrate_storage_volume

# 回退点不会自动删除；确认发布稳定后由管理员归档。

# ---------- 启动新版本 ----------
upgrade_failed() {
  cat <<EOF >&2
================================================================
$1。排查步骤：
  1. docker compose logs --tail 100 server web ocr
  2. 完整回退（同时恢复旧数据与三个旧镜像）：
     bash deploy/rollback.sh "$(pwd)" "$(pwd)/$RELEASE_DIR"
================================================================
EOF
  exit 1
}
# Persist the selected release so subsequent Compose commands cannot fall back to latest.
ENV_TMP=$(mktemp .env.release.XXXXXX)
awk '!/^RELEASE_TAG=/' .env > "$ENV_TMP"
printf '\nRELEASE_TAG=%s\n' "$RELEASE_TAG" >> "$ENV_TMP"
chmod 600 "$ENV_TMP"
mv "$ENV_TMP" .env
# web 等 server 健康检查通过才启动；server 起不来时 up 直接失败
info "启动新版本…"
docker compose up -d --pull never || upgrade_failed "启动失败"
for service in web server ocr; do
  printf 'new_%s=%s\n' "$service" "$(docker compose images -q "$service")" >> "$RELEASE_DIR/release.txt"
done

WEB_PORT=$(grep '^WEB_PORT=' .env | cut -d= -f2 || true)
WEB_PORT="${WEB_PORT:-8080}"
info "健康检查…"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1 &&
     docker compose exec -T ocr python -c 'import os,urllib.request; print(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8000/ready",headers={"X-API-Key":os.environ["OCR_API_KEY"]}),timeout=30).read().decode())' > "$RELEASE_DIR/ocr-ready.json" 2>/dev/null; then
    info "升级完成 ✓  $OLD_COMMIT → $NEW_COMMIT"
    info "发布与回退记录：$RELEASE_DIR"
    exit 0
  fi
  sleep 3
done
upgrade_failed "健康检查超时"
