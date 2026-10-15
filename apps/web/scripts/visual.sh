#!/usr/bin/env bash
# 视觉回归（e2e/visual.spec.ts）：在固定的 Playwright 容器里跑，和 CI 的 visual job 用同一个镜像加同一个字体包
# （fonts-noto-cjk：有真正的粗体，字体栈里本来就列了 Noto Sans CJK SC；镜像自带的文泉驿正黑没有粗体，标题会变细），
# 浏览器与字体都由镜像决定，基线只在这里生成和比较，不受本机字体和浏览器影响。
#
#   apps/web/scripts/visual.sh            与基线比较；失败时差异图在 apps/web/test-results/visual/
#   apps/web/scripts/visual.sh --update   有意改了 UI 后重建变化了的基线，之后人工看一遍差异再提交
#
# 需要 docker。镜像版本取自 pnpm-lock.yaml 里的 @playwright/test，升级 Playwright 时 CI 的镜像标签一起改；
# 本地派生镜像的标签带 Dockerfile 内容的哈希，改了字体包会自动重建。
# 仓库按 git 的文件清单（含未提交的改动，跳过已删除的）复制进容器，在容器里安装依赖与构建，不动本机的 node_modules 和 dist；
# pnpm 缓存放在 docker 卷 canglin-visual-pnpm 里，第二次起很快。容器限制在 4 核 / 6 GB 内（这台机器可能还跑着别的服务），
# 写回宿主机的基线与差异图改成当前用户所有（容器里是 root）。
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
BASE_IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"
DOCKERFILE=$(printf 'FROM %s\nRUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk && rm -rf /var/lib/apt/lists/*\n' "$BASE_IMAGE")
IMAGE="canglin-visual:${VERSION}-$(printf '%s' "$DOCKERFILE" | sha256sum | cut -c1-8)"
CPUS=$(nproc 2>/dev/null || echo 4); [ "$CPUS" -gt 4 ] && CPUS=4
SNAPSHOTS="$ROOT/apps/web/e2e/visual.spec.ts-snapshots"
RESULTS="$ROOT/apps/web/test-results/visual"
mkdir -p "$SNAPSHOTS" "$RESULTS"
rm -rf "${RESULTS:?}"/*

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "[visual] 第一次运行：构建 $IMAGE（$BASE_IMAGE + fonts-noto-cjk）…"
  printf '%s' "$DOCKERFILE" | docker build -q -t "$IMAGE" - >/dev/null
fi
echo "[visual] 镜像 $IMAGE$([ "$UPDATE" = 1 ] && echo '，重建变化了的基线')"
cd "$ROOT"
git ls-files -z --cached --others --exclude-standard -- . ':!.claude' \
  | while IFS= read -r -d '' f; do if [ -e "$f" ]; then printf '%s\0' "$f"; fi; done \
  | tar --null -T - -cf - \
  | docker run --rm -i --ipc=host --cpus "$CPUS" --memory 6g \
      -v canglin-visual-pnpm:/pnpm-store \
      -v "$SNAPSHOTS":/out/snapshots \
      -v "$RESULTS":/out/results \
      -e UPDATE="$UPDATE" -e CI=1 -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
      "$IMAGE" bash -euo pipefail -c '
        mkdir -p /work && tar -xf - -C /work && cd /work
        npm install -g "$(node -p "require(\"./package.json\").packageManager")" >/dev/null
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
        chown -R "$HOST_UID:$HOST_GID" /out/snapshots /out/results
        exit $status'
