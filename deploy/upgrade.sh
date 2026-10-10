#!/usr/bin/env bash
# 仓廪升级脚本：拉代码 → 拉新镜像 → 停机备份数据 → 升级 → 健康检查
# 用法（任意目录均可执行）：
#   bash deploy/upgrade.sh             # 默认操作 /opt/canglin
#   curl -fsSL https://raw.githubusercontent.com/YePiXpert/canglin/main/deploy/upgrade.sh | bash
#                                      # 一行升级：默认 /opt/canglin
#   curl -fsSL …/upgrade.sh | bash -s -- /path/to/repo
#                                      # 仓库在别处时指定目录（或用环境变量 CANGLIN_REPO）
# 可选参数：--build 本地构建三个镜像；--full 兼容旧参数；--no-pull 跳过 git pull
# 改名前的 Procure Lite 实例（目录、Compose 项目、数据卷）在升级过程中自动迁移，可重复执行。
set -euo pipefail

info() { printf '\033[1;34m[升级]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[警告]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 定位部署目录 ----------
# 优先级：首个非 -- 参数 > CANGLIN_REPO > /opt/canglin。
# 不根据脚本位置或当前工作目录选择仓库，以免覆盖 /workspace 开发副本。
DEFAULT_DIR=/opt/canglin
LEGACY_DIR=/opt/procure-lite
REPO_DIR="${CANGLIN_REPO:-$DEFAULT_DIR}"
if [ $# -gt 0 ] && [ "${1:0:2}" != "--" ]; then REPO_DIR="$1"; shift; fi
# 旧目录只在默认路径不存在时迁移，自定义路径不做猜测；前置检查全部通过后才移动。
MOVE_FROM=""
if [ "$REPO_DIR" = "$DEFAULT_DIR" ] && [ ! -e "$REPO_DIR" ] && [ -d "$LEGACY_DIR" ]; then
  MOVE_FROM="$LEGACY_DIR"
fi
SOURCE_DIR="${MOVE_FROM:-$REPO_DIR}"
[ -d "$SOURCE_DIR" ] || die "部署目录不存在：$REPO_DIR；请先部署，或用参数 / CANGLIN_REPO 指定已有目录"
[ -d "$SOURCE_DIR/.git" ] && [ -f "$SOURCE_DIR/docker-compose.yml" ] \
  || die "部署目录不是有效仓库：$SOURCE_DIR"
cd "$SOURCE_DIR"
if [ -n "$MOVE_FROM" ]; then
  info "部署目录：$REPO_DIR（前置检查通过后由旧目录 $MOVE_FROM 迁移）"
else
  info "部署目录：$(pwd)"
fi

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
LEGACY_PROJECT="procure-lite"
LEGACY_VOLUME="procure-lite_procure-state"
# 新卷不存在而改名前的旧卷存在时，视为待迁移：停机后复制，不算缺卷。
MIGRATE_VOLUME=0
if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  docker volume inspect "$LEGACY_VOLUME" >/dev/null 2>&1 \
    || die "找不到数据卷 $VOLUME（也没有改名前的 $LEGACY_VOLUME）；服务未停止"
  MIGRATE_VOLUME=1
  info "停机后将把旧数据卷 $LEGACY_VOLUME 复制到 $VOLUME（旧卷保留）"
fi
# 改名前的 Compose 项目仍有容器：旧镜像从它记录，启动新版本前停止并删除（否则端口冲突）。
LEGACY_CONTAINERS=$(docker ps -a --filter "label=com.docker.compose.project=$LEGACY_PROJECT" -q)
OLD_PROJECT="$PROJECT"
[ -z "$LEGACY_CONTAINERS" ] || OLD_PROJECT="$LEGACY_PROJECT"
docker image inspect alpine >/dev/null 2>&1 || docker pull alpine
if [ "$GIT_PULL" = 1 ]; then
  git diff --quiet && git diff --cached --quiet || die "部署仓库有已跟踪文件的本机改动；请先保存改动，升级不会覆盖它们"
fi

# ---------- 迁移改名前的目录与 Git 远端（幂等） ----------
if [ -n "$MOVE_FROM" ]; then
  cd /
  mv "$MOVE_FROM" "$REPO_DIR"
  cd "$REPO_DIR"
  info "已将部署目录 $MOVE_FROM 迁移到 $REPO_DIR"
fi
ORIGIN_URL=$(git remote get-url origin 2>/dev/null || true)
case "$ORIGIN_URL" in
  *github.com[:/]YePiXpert/procure-lite|*github.com[:/]YePiXpert/procure-lite.git)
    git remote set-url origin "${ORIGIN_URL/procure-lite/canglin}"
    info "Git 远端已改为 ${ORIGIN_URL/procure-lite/canglin}"
    ;;
esac

OLD_COMMIT=$(git rev-parse HEAD)
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="pre-upgrade-backups"
RELEASE_DIR="$BACKUP_DIR/release-$STAMP"
mkdir -p "$RELEASE_DIR"
chmod 700 "$BACKUP_DIR" "$RELEASE_DIR"
cp docker-compose.yml "$RELEASE_DIR/old-compose.yml"
printf 'services:\n' > "$RELEASE_DIR/old-images.yml"
printf 'old_source=%s\n' "$OLD_COMMIT" > "$RELEASE_DIR/release.txt"
for service in web server ocr; do
  old_image=$(docker compose -p "$OLD_PROJECT" images -q "$service" | head -n 1)
  [ -n "$old_image" ] || die "无法记录 $service 的旧镜像；请使用首次部署流程或先恢复当前部署"
  rollback_tag="canglin-rollback-$service:$STAMP"
  docker tag "$old_image" "$rollback_tag"
  printf '  %s:\n    image: %s\n' "$service" "$rollback_tag" >> "$RELEASE_DIR/old-images.yml"
  printf 'old_%s=%s\n' "$service" "$old_image" >> "$RELEASE_DIR/release.txt"
done

# ---------- 拉取新代码 ----------
if [ "$GIT_PULL" = 1 ]; then
  info "拉取最新代码…"
  git fetch origin main --tags
  git merge --ff-only origin/main
fi
NEW_COMMIT=$(git rev-parse HEAD)
export RELEASE_TAG="sha-$(git rev-parse --short=7 HEAD)"
printf 'new_source=%s\nrelease_tag=%s\nocr_model=PP-OCRv6_medium\n' "$NEW_COMMIT" "$RELEASE_TAG" >> "$RELEASE_DIR/release.txt"
cp docker-compose.yml "$RELEASE_DIR/new-compose.yml"
find apps/server/prisma/migrations -name migration.sql -exec sha256sum {} \; > "$RELEASE_DIR/migrations.sha256"
sha256sum apps/ocr/models.sha256 apps/ocr/requirements.lock >> "$RELEASE_DIR/release.txt"
info "代码版本：$OLD_COMMIT → $NEW_COMMIT"
# 后续按改名后的项目和数据卷操作；代码仍是改名前版本（如 --no-pull）时在停机前退出。
grep -q "^name: $PROJECT\$" docker-compose.yml \
  || die "docker-compose.yml 不是改名后的版本（缺少 name: $PROJECT）；请去掉 --no-pull 重新执行，服务未停止"
# .env 的 COMPOSE_PROJECT_NAME 优先于 compose 文件的 name:，旧值不改会以旧项目名启动并新建空卷。
if grep -q "^COMPOSE_PROJECT_NAME=$LEGACY_PROJECT\$" .env; then
  ENV_TMP=$(mktemp .env.project.XXXXXX)
  sed "s/^COMPOSE_PROJECT_NAME=$LEGACY_PROJECT\$/COMPOSE_PROJECT_NAME=$PROJECT/" .env > "$ENV_TMP"
  chmod 600 "$ENV_TMP"
  mv "$ENV_TMP" .env
  info ".env 的 COMPOSE_PROJECT_NAME 已由 $LEGACY_PROJECT 改为 $PROJECT"
fi
# 以 Compose 实际解析结果为准（shell 中导出的 COMPOSE_PROJECT_NAME 同样会覆盖），不对就在停机前退出。
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
if [ -n "$LEGACY_CONTAINERS" ]; then
  info "停止改名前的 Compose 项目 $LEGACY_PROJECT（容器在启动新版本前删除）…"
  docker stop $LEGACY_CONTAINERS >/dev/null
fi
# 旧容器停止后才复制，新卷交给 server 的 node 用户（uid 1000）。
# 复制失败时删除不完整的新卷，重跑会重新复制；旧卷始终只读、不删除。
if [ "$MIGRATE_VOLUME" = 1 ]; then
  info "复制数据卷 $LEGACY_VOLUME → $VOLUME …"
  docker volume create --label "com.docker.compose.project=$PROJECT" \
    --label com.docker.compose.volume=state "$VOLUME" >/dev/null
  if ! docker run --rm -v "$LEGACY_VOLUME:/from:ro" -v "$VOLUME:/to" alpine \
      sh -c 'cp -a /from/. /to/ && chown -R 1000:1000 /to'; then
    docker volume rm "$VOLUME" >/dev/null 2>&1 || true
    die "复制数据卷失败，已删除不完整的 $VOLUME；旧卷未改动，旧容器已停止但保留（docker start $(echo $LEGACY_CONTAINERS) 可恢复旧服务）。排除原因后重新执行本脚本"
  fi
  info "数据卷已复制；旧卷 $LEGACY_VOLUME 保留，确认新版本正常后可自行 docker volume rm $LEGACY_VOLUME"
fi

docker run --rm \
  -v "$VOLUME:/state:ro" \
  -v "$(pwd)/$RELEASE_DIR:/backup" \
  alpine tar czf "/backup/state.tar.gz" -C /state .
docker run --rm -v "$(pwd)/$RELEASE_DIR:/backup:ro" alpine tar tzf /backup/state.tar.gz >/dev/null
info "已备份：$RELEASE_DIR/state.tar.gz（数据库 + 附件；外部 secret 保持外部管理）"
# server 以 node 用户运行：回退到旧版（root）期间写入的文件也一并交还 uid 1000，幂等
docker run --rm -v "$VOLUME:/state" alpine chown -R 1000:1000 /state

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
if [ -n "$LEGACY_CONTAINERS" ]; then
  docker rm $LEGACY_CONTAINERS >/dev/null
  info "已删除改名前项目 $LEGACY_PROJECT 的容器（遗留网络 ${LEGACY_PROJECT}_default 可自行 docker network rm）"
fi
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
