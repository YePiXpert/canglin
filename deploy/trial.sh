#!/usr/bin/env bash
# Isolated candidate trial. Never invokes deploy.sh, upgrade.sh or production Compose.
set -euo pipefail
REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROJECT=canglin-trial-ce8fe2e
REVISION=ce8fe2ef40f7d0e4f482335ead0143716e3e9478
TRIAL_DIR=$(realpath -m "${CANGLIN_TRIAL_DIR:-$REPO_DIR/state/trial-ce8fe2e}")
ACTION=${1:-status}
case "$ACTION" in up|check|status|logs|stop|smoke) ;; *) echo 'Usage: bash deploy/trial.sh up|check|status|logs|stop|smoke' >&2; exit 2 ;; esac
[ $# -le 1 ] || { echo 'Unexpected arguments' >&2; exit 2; }
# Ignore inherited Compose routing and credentials. Read only this trial's generated env file.
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES TRIAL_OCR_API_KEY
COMPOSE=(docker compose --project-directory "$REPO_DIR" --env-file "$TRIAL_DIR/env" -p "$PROJECT" -f "$REPO_DIR/deploy/compose.trial.yml")
if [ "$ACTION" = up ] && [ ! -f "$TRIAL_DIR/env" ]; then
  mkdir -p "$TRIAL_DIR"
  chmod 700 "$TRIAL_DIR"
  trial_key=$(openssl rand -hex 32)
  (umask 077; printf 'TRIAL_OCR_API_KEY=%s\n' "$trial_key" > "$TRIAL_DIR/env")
  unset trial_key
fi
[ -s "$TRIAL_DIR/env" ] || { echo 'Trial not initialized. Run bash deploy/trial.sh up.' >&2; exit 1; }
verify_images() {
  local image revision images
  images=$("${COMPOSE[@]}" config --images)
  [ "$(printf '%s\n' "$images" | wc -l)" -eq 3 ] || { echo 'Expected exactly three trial images' >&2; return 1; }
  while IFS= read -r image; do
    revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
    [ "$revision" = "$REVISION" ] || { echo "Candidate revision mismatch: $image" >&2; return 1; }
  done <<< "$images"
}
check() {
  # Check the real server -> OCR link without returning the shared internal key.
  curl --max-time 5 -fsS http://127.0.0.1:18080/ >/dev/null
  curl --max-time 5 -fsS http://127.0.0.1:18080/api/health >/dev/null
  "${COMPOSE[@]}" exec -T server node -e '
    (async () => {
      const api = await fetch("http://127.0.0.1:3000/api/health", {signal: AbortSignal.timeout(5000)});
      const ocr = await fetch(process.env.OCR_BASE_URL + "/ready", {signal: AbortSignal.timeout(30000), headers: {"X-API-Key": process.env.OCR_API_KEY}});
      if (!api.ok || !ocr.ok) throw new Error("API or OCR is not ready");
      const a = await api.json(), o = await ocr.json();
      if (!a.database || !o.ok || o.engineVersion !== "3.7.0" || o.model !== "PP-OCRv6_medium") throw new Error("Unexpected readiness result");
      console.log(JSON.stringify({api: a, ocr: o}));
    })().catch(e => {console.error(e.message); process.exit(1)});'
}
case "$ACTION" in
  up)
    "${COMPOSE[@]}" pull
    verify_images
    "${COMPOSE[@]}" up -d --no-build --pull never
    for attempt in $(seq 1 60); do
      if check > "$TRIAL_DIR/readiness.json" 2>/dev/null; then
        echo "Trial ready: http://127.0.0.1:18080 (candidate $REVISION)"
        echo "Independent volume: ${PROJECT}_trial-state; config: $TRIAL_DIR"
        exit 0
      fi
      sleep 3
    done
    echo 'Trial readiness failed; inspect with deploy/trial.sh logs. Existing services were not modified.' >&2
    exit 1
    ;;
  check) verify_images; check ;;
  status) "${COMPOSE[@]}" ps ;;
  logs) "${COMPOSE[@]}" logs --tail 100 ;;
  stop) "${COMPOSE[@]}" down; echo 'Trial containers stopped; trial data retained.' ;;
  smoke)
    verify_images
    # A separate disposable server with an anonymous volume and no network. Never use trial data.
    server_image=$(awk '$1 == "server:" {server=1; next} server && $1 == "image:" {print $2; exit}' "$REPO_DIR/deploy/compose.trial.yml")
    container=''
    cleanup() { [ -z "$container" ] || docker rm -f -v "$container" >/dev/null; }
    trap cleanup EXIT
    container=$(docker run -d --rm --network none --cpus 1 --memory 1g \
      --label com.centurylinklabs.watchtower.enable=false \
      --mount type=volume,destination=/app/state \
      -e DATA_DIR=/app/state -e DATABASE_URL=file:/app/state/procure.db \
      -e OCR_BASE_URL=http://127.0.0.1:8000 -e OCR_API_KEY=isolated-smoke \
      "$server_image")
    # The smoke test must match the candidate's API, so read it from the pinned revision, not the working tree.
    git -C "$REPO_DIR" show "$REVISION:deploy/tests/smoke-api.cjs" | docker exec -i "$container" node | tee "$TRIAL_DIR/smoke.json"
    ;;
esac
