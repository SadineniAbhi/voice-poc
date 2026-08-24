#!/bin/bash
# Runs once on first boot (GCP startup-script). Idempotent-ish: safe to leave
# in place, but redeploys after this point go through scripts/deploy.sh, not
# this script.
set -euxo pipefail

# --- base packages ---
apt-get update -y
apt-get install -y ca-certificates curl gnupg git nginx

# --- docker engine + compose plugin (official repo) ---
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# --- certbot for TLS (run manually later via scripts/init-tls.sh, once DNS points here) ---
apt-get install -y certbot python3-certbot-nginx

usermod -aG docker ${ssh_username} || true

# --- app checkout ---
APP_DIR=/opt/app
if [ ! -d "$APP_DIR/.git" ]; then
  git clone ${github_repo_url} "$APP_DIR"
fi
chown -R ${ssh_username}:${ssh_username} "$APP_DIR"

# --- env file placeholder (gitignored, so `git pull` never touches it again) ---
if [ ! -f "$APP_DIR/backend/.env" ]; then
  cp "$APP_DIR/backend/example.env" "$APP_DIR/backend/.env"
  echo "*** backend/.env created from example.env — set OPENAI_API_KEY, then re-run docker compose ***"
fi

# --- host nginx reverse proxy: plain HTTP for now, TLS added by scripts/init-tls.sh ---
cat > /etc/nginx/sites-available/app.conf <<'NGINX'
server {
    listen 80;
    server_name ${domain_name};

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/app.conf /etc/nginx/sites-enabled/app.conf
nginx -t && systemctl restart nginx

# --- bring up the app containers ---
cd "$APP_DIR"
su ${ssh_username} -c "cd $APP_DIR && docker compose -f docker-compose.prod.yml up -d --build"
