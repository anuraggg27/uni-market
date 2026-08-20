#!/usr/bin/env bash
set -Eeuo pipefail

cd /opt/uni-market/source
git fetch --prune origin main
git show origin/main:infra/deploy.sh | /bin/bash
