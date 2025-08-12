#!/usr/bin/env bash
set -euo pipefail
npm ci
npm run build
mkdir -p build
( cd dist && zip -r ../build/lambda.zip . )
echo "Built build/lambda.zip"
