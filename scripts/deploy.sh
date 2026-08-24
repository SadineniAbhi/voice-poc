#!/bin/bash
# CI/CD entrypoint: ssh into the VM and run this (or run its two lines by hand).
#   ssh abhi@<vm-ip> 'cd /opt/app && ./scripts/deploy.sh'
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
docker compose -f docker-compose.prod.yml up -d --build

# Free disk space on the small boot disk — drop dangling images left behind
# by the rebuild.
docker image prune -f
