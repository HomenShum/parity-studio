#!/usr/bin/env bash
# One-shot: add CONVEX_DEPLOY_KEY to Vercel + force redeploy + verify.
#
# Run this once after generating a Production Deploy Key in the Convex
# dashboard for blissful-pig-998. The key is read silently via `read -s`
# so it never appears in your shell history or scrollback.
#
# Usage:  bash scripts/add-deploy-key-and-redeploy.sh

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Paste your CONVEX_DEPLOY_KEY (input hidden, then press Enter)"
read -rs KEY
echo

if [ -z "$KEY" ]; then
  echo "ERR: empty key — aborting"
  exit 1
fi

# Quick shape check — production deploy keys start with "prod:"
case "$KEY" in
  prod:*) ;;
  *)
    echo "WARN: key does not start with 'prod:' — Convex production deploy keys"
    echo "      look like 'prod:blissful-pig-998|<token>'. Continuing anyway."
    ;;
esac

echo "==> Adding CONVEX_DEPLOY_KEY to Vercel (production)"
# The Vercel CLI reads env value from stdin when piped.
# `--sensitive` marks it as a secret in the dashboard.
echo "$KEY" | npx vercel env add CONVEX_DEPLOY_KEY production --sensitive 2>&1 | tail -5
unset KEY

echo
echo "==> Triggering redeploy via empty commit"
git commit --allow-empty -m "chore: trigger redeploy with CONVEX_DEPLOY_KEY for atomic backend+frontend ship"
git push origin main

echo
echo "==> Waiting for Vercel build to finish (this typically takes ~30-60s)"
PREV=$(npx vercel ls 2>&1 | grep -oE 'parity-studio-[a-z0-9]+-hshum[^ ]+vercel\.app' | head -1)
echo "    previous top deploy: $PREV"

while :; do
  CUR=$(npx vercel ls 2>&1 | grep -oE 'parity-studio-[a-z0-9]+-hshum[^ ]+vercel\.app' | head -1)
  STATUS=$(npx vercel ls 2>&1 | head -10 | grep -E "Ready|Error|Building|Queued" | head -1)
  if [ "$CUR" != "$PREV" ]; then
    echo "    new deploy: $CUR"
    case "$STATUS" in
      *Ready*) echo "    ✓ READY"; break ;;
      *Error*) echo "    ✗ ERROR — fetching logs"; npx vercel inspect "https://$CUR" --logs | tail -30; exit 1 ;;
      *) echo "    status: $STATUS — still building"; sleep 5; continue ;;
    esac
  fi
  sleep 5
done

echo
echo "==> Verifying frontend signals on https://parity-studio.vercel.app/"
curl -fsSL https://parity-studio.vercel.app/ \
  | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' \
  | head -1 \
  | xargs -I{} curl -fsSL "https://parity-studio.vercel.app{}" \
  | grep -cE "generateSourceImage|patchFile|agent-chat-rail|monaco" \
  | xargs -I{} echo "    feature signal hits in bundle: {} (expect ≥4)"

echo
echo "==> Verifying backend functions exist on blissful-pig-998"
echo "    (calling function-spec which lists registered functions)"
npx convex function-spec --prod 2>&1 \
  | grep -E "generateSourceImage|patchFile|targetFile" \
  | head -5

echo
echo "==> DONE. Site live at https://parity-studio.vercel.app/"
echo "    Frontend = latest commit. Backend = blissful-pig-998 with new functions."
echo "    Future pushes auto-deploy both atomically."
