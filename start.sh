#!/usr/bin/env sh
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "请先安装 Node.js 18+：https://nodejs.org"; exit 1; }
[ -d node_modules/yaml ] || npm install --no-audit --no-fund || exit 1
node server.js
