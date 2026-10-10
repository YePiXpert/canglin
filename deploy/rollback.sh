#!/usr/bin/env bash
# Restore the entire stopped data volume with its three pinned old images.
set -euo pipefail
PROJECT=canglin
VOLUME=canglin_state
REPO_DIR=${1:?Usage: rollback.sh /repo /repo/pre-upgrade-backups/release-TIMESTAMP}
RELEASE_DIR=${2:?Missing release directory}
cd "$REPO_DIR"
REPO_DIR=$(pwd)
RELEASE_DIR=$(realpath "$RELEASE_DIR")
for file in state.tar.gz old-compose.yml old-images.yml release.txt; do
  test -s "$RELEASE_DIR/$file" || { echo "Missing rollback artifact: $file" >&2; exit 1; }
done
# Validate images, volume and archive before stopping the application.
docker volume inspect "$VOLUME" >/dev/null
while IFS= read -r image; do
  docker image inspect "$image" >/dev/null
done < <(awk '$1 == "image:" {print $2}' "$RELEASE_DIR/old-images.yml")
docker run --rm -v "$RELEASE_DIR:/backup:ro" alpine tar tzf /backup/state.tar.gz >/dev/null
# 改名前的旧配置用卷键 procure-state：钉到当前数据卷，否则会以 canglin 项目名新建空卷。
if grep -q '^  procure-state:' "$RELEASE_DIR/old-compose.yml" && ! grep -q '^volumes:' "$RELEASE_DIR/old-images.yml"; then
  printf 'volumes:\n  procure-state:\n    name: %s\n' "$VOLUME" >> "$RELEASE_DIR/old-images.yml"
  echo "旧配置使用改名前的卷键 procure-state，已在 old-images.yml 中钉到 $VOLUME"
fi
docker compose down --remove-orphans
# Retain the pre-rollback state, including any writes made since the upgrade.
ROLLBACK_SNAPSHOT="before-rollback-$(date +%Y%m%d-%H%M%S)-$$.tar.gz"
docker run --rm -v "$VOLUME:/state:ro" -v "$RELEASE_DIR:/backup" alpine \
  tar czf "/backup/$ROLLBACK_SNAPSHOT" -C /state .
docker run --rm -v "$RELEASE_DIR:/backup:ro" alpine tar tzf "/backup/$ROLLBACK_SNAPSHOT" >/dev/null
docker run --rm -v "$VOLUME:/state" -v "$RELEASE_DIR:/backup:ro" alpine \
  sh -ec 'find /state -mindepth 1 -maxdepth 1 -exec rm -rf {} +; tar xzf /backup/state.tar.gz -C /state'
# Explicit -f disables automatic override discovery: preserve the local deployment override.
OVERRIDE_ARGS=()
for override in docker-compose.override.yml docker-compose.override.yaml; do
  if [ -f "$override" ]; then
    OVERRIDE_ARGS=(-f "$REPO_DIR/$override")
    break
  fi
done
docker compose --env-file .env -p "$PROJECT" --project-directory "$REPO_DIR" \
  -f "$RELEASE_DIR/old-compose.yml" "${OVERRIDE_ARGS[@]}" -f "$RELEASE_DIR/old-images.yml" up -d --no-build --pull never
echo "已恢复旧数据及旧镜像。请检查 API、数据库和 OCR 就绪状态；发布记录：$RELEASE_DIR/release.txt"
echo "回退前数据已保留：$RELEASE_DIR/$ROLLBACK_SNAPSHOT"
echo "回退后的 Compose 管理必须继续使用上述旧配置和旧镜像文件；勿直接运行 docker compose up。参见 docs/upgrade-2026-09.md。"
