#!/usr/bin/env bash
# Sourced after cd to the deployment repository. Never prints secrets.
prepare_storage_path() {
  export CANGLIN_DATA_DIR="$(pwd -P)/data"
  [ ! -L "$CANGLIN_DATA_DIR" ] || { echo 'data must be a real directory, not a symlink' >&2; return 1; }
  mkdir -p "$CANGLIN_DATA_DIR"
  local tmp
  tmp=$(mktemp .env.storage.XXXXXX)
  awk '!/^CANGLIN_DATA_DIR=/' .env > "$tmp"
  # Compose dotenv single quotes preserve spaces and dollar signs in paths.
  case "$CANGLIN_DATA_DIR" in *"'"*|*$'\n'*) rm -f "$tmp"; echo 'Unsupported deployment path' >&2; return 1;; esac
  printf "\nCANGLIN_DATA_DIR='%s'\n" "$CANGLIN_DATA_DIR" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
}

check_storage_volume() {
  local driver device
  driver=$(docker volume inspect canglin_state --format '{{.Driver}}') || return 1
  device=$(docker volume inspect canglin_state --format '{{if .Options}}{{index .Options "device"}}{{end}}') || return 1
  [ "$driver" = local ] || { echo 'Unsupported state volume driver' >&2; return 1; }
  if [ -n "$device" ]; then
    [ "$device" = "$CANGLIN_DATA_DIR" ] || { echo 'State volume points to another directory; refusing migration' >&2; return 1; }
  elif [ -n "$(find "$CANGLIN_DATA_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    echo 'Both legacy volume and data/ exist; refusing to overwrite either' >&2
    return 1
  fi
}

# Call only with all application containers removed and a verified backup available.
migrate_storage_volume() {
  local device legacy
  device=$(docker volume inspect canglin_state --format '{{if .Options}}{{index .Options "device"}}{{end}}') || return 1
  [ -z "$device" ] || return 0
  legacy="canglin_state_legacy_$(date +%Y%m%d%H%M%S)_$$"
  docker volume create "$legacy" >/dev/null
  # Keep an independent copy before replacing volume metadata. Failures never delete the source.
  docker run --rm -v canglin_state:/source:ro -v "$legacy:/legacy" \
    -v "$CANGLIN_DATA_DIR:/target" alpine sh -ec \
    'cp -a /source/. /legacy/; cp -a /source/. /target/; diff -r /source /legacy; diff -r /source /target'
  printf 'legacy_volume=%s\ndata_directory=%s\n' "$legacy" "$CANGLIN_DATA_DIR" >> "$RELEASE_DIR/release.txt"
  docker volume rm canglin_state >/dev/null
  docker volume create --driver local --opt type=none --opt o=bind --opt "device=$CANGLIN_DATA_DIR" \
    --label com.docker.compose.project=canglin --label com.docker.compose.volume=state canglin_state >/dev/null
  echo "数据已迁入 $CANGLIN_DATA_DIR；迁移前副本保留在 $legacy"
}
