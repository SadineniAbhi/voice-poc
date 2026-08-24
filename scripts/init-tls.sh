#!/bin/bash
# Run this ONCE, on the VM, after your domain's DNS A record points at the
# VM's static IP and has propagated. Obtains a Let's Encrypt cert and
# rewrites the nginx site to serve HTTPS + redirect HTTP -> HTTPS.
# Renewal is automatic afterwards via the certbot.timer systemd unit.
#
# Usage (on the VM): sudo ./scripts/init-tls.sh voice.sadineni.in sadineniabhi@gmail.com
set -euo pipefail

DOMAIN="${1:?Usage: init-tls.sh <domain> <email>}"
EMAIL="${2:?Usage: init-tls.sh <domain> <email>}"

certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --redirect --non-interactive

systemctl status certbot.timer --no-pager
