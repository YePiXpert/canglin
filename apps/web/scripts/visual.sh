#!/usr/bin/env bash
# 视觉回归（e2e/visual.spec.ts）：在固定的 Playwright 容器里跑，和 CI 的 visual job 用同一个镜像，
# 浏览器与字体都由镜像决定，基线只在这里生成和比较，不受本机字体和浏览器影响。
#
#   apps/web/scripts/visual.sh            与基线比较；失败时差异图在 apps/web/test-results/visual/
#   apps/web/scripts/visual.sh --update   有意改了 UI 后重建变化了的基线，之后人工看一遍差异再提交
#
# 需要 docker。镜像版本取自 pnpm-lock.yaml 里的 @playwright/test，升级 Playwright 时 CI 的镜像标签一起改。
# 仓库按 git 的文件清单（含未提交的改动）复制进容器，在容器里安装依赖与构建，不动本机的 node_modules 和 dist；
# pnpm 缓存放在 docker 卷 canglin-visual-pnpm 里，第二次起很快。
set -euo pipefail

UPDATE=0
for arg in "$@"; do
  case "$arg" in
    --update) UPDATE=1 ;;
    *) echo "未知参数：$arg（支持 --update）" >&2; exit 1 ;;
  esac
done

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
VERSION=$(grep -oE "@playwright/test@[0-9]+\.[0-9]+\.[0-9]+" "$ROOT/pnpm-lock.yaml" | head -n 1 | cut -d@ -f3)
[ -n "$VERSION" ] || { echo "在 pnpm-lock.yaml 里找不到 @playwright/test 的版本" >&2; exit 1; }
IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"
SNAPSHOTS="$ROOT/apps/web/e2e/visual.spec.ts-snapshots"
RESULTS="$ROOT/apps/web/test-results/visual"
mkdir -p "$SNAPSHOTS" "$RESULTS"
rm -rf "${RESULTS:?}"/*

echo "[visual] 镜像 $IMAGE$([ "$UPDATE" = 1 ] && echo '，重建变化了的基线')"
cd "$ROOT"
git ls-files -z --cached --others --exclude-standard -- . ':!.claude' \
  | tar --null -T - --ignore-failed-read -cf - 2>/dev/null \
  | docker run --rm -i --ipc=host \
      -v canglin-visual-pnpm:/pnpm-store \
      -v "$SNAPSHOTS":/out/snapshots \
      -v "$RESULTS":/out/results \
      -e UPDATE="$UPDATE" -e CI=1 \
      "$IMAGE" bash -euo pipefail -c '
        mkdir -p /work && tar -xf - -C /work && cd /work
        npm install -g "$(node -p "require(\"./package.json\").packageManager")" >/dev/null 2>&1
        pnpm config set store-dir /pnpm-store >/dev/null
        pnpm install --frozen-lockfile >/dev/null
        pnpm --filter @canglin/shared build >/dev/null
        pnpm --filter @canglin/server build >/dev/null
        cd apps/web
        status=0
        if [ "$UPDATE" = 1 ]; then
          pnpm exec playwright test --project=visual --update-snapshots || status=$?
          rm -rf /out/snapshots/* && cp -r e2e/visual.spec.ts-snapshots/. /out/snapshots/
        else
          pnpm exec playwright test --project=visual || status=$?
        fi
        cp -r test-results/. /out/results/ 2>/dev/null || true
        exit $status'
