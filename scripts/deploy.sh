#!/bin/bash
# CI/CD entrypoint — run this from your machine (or a CI runner with SSH
# access), not on the VM. SSHes in, pulls latest, rebuilds/restarts the
# compose stack, and prunes dangling images to keep the small disk clear.
#
#   ./scripts/deploy.sh
#   VM_HOST=abhi@1.2.3.4 ./scripts/deploy.sh   # override target
set -euo pipefail

VM_HOST="${VM_HOST:-abhi@136.65.132.114}"
APP_DIR="${APP_DIR:-/opt/app}"

ssh "$VM_HOST" "
  set -euo pipefail
  cd '$APP_DIR'
  git pull --ff-only
  docker compose -f docker-compose.prod.yml up -d --build
  docker image prune -f
"
