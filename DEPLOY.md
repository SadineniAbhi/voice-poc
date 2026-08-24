# Deploying to GCP

Cheapest viable setup: one `e2-micro` VM (Google's Always Free tier machine
type) in `us-central1`, a 30GB standard persistent disk (also Always Free), a
static IP (free while attached to a running instance), and nginx on the VM
itself doing TLS termination + reverse proxy in front of the docker-compose
containers. No Cloud SQL, no load balancer, no NAT gateway — all of those
cost real money and none are needed here.

Expected cost: **$0/month** as long as you stay within the Always Free quotas
(1 e2-micro instance, 30GB disk, 1GB egress/month to most destinations — the
WebRTC audio itself goes browser → OpenAI directly, not through this VM, so
egress stays low).

## 1. Create the VM

```bash
cd infra
terraform init
terraform apply
```

Defaults in `variables.tf` already match this project (`project-2026-486210`,
domain `voice.sadineni.in`, your SSH key). Override anything with
`-var=...` or copy `terraform.tfvars.example` to `terraform.tfvars`.

Note the `vm_public_ip` output when it's done.

## 2. Point DNS

Create an A record: `voice.sadineni.in` → `<vm_public_ip>`. Wait for it to
propagate (`dig voice.sadineni.in` should return the VM's IP).

The VM is already serving plain HTTP at that point (nginx → the frontend/
backend containers), so you can sanity-check `http://voice.sadineni.in`
before TLS is on.

## 3. Set the OpenAI key

`docker-compose.prod.yml` reads `OPENAI_API_KEY` (and a few other vars) via
`${OPENAI_API_KEY}` substitution, which `docker compose` fills from either
the shell environment or a `.env` file sitting next to the compose file —
here that's `/opt/app/.env` (project root, **not** `backend/.env`). Create
it once on the VM:

```bash
ssh abhi@<vm_public_ip>
echo 'OPENAI_API_KEY=sk-...' >> /opt/app/.env
cd /opt/app && docker compose -f docker-compose.prod.yml up -d backend
```

It's a plain file owned by you, gitignored, and untouched by future
`git pull`s — no `sudo` needed to edit it.

## 4. Get a TLS cert

Once DNS resolves to the VM:

```bash
ssh abhi@<vm_public_ip>
sudo /opt/app/scripts/init-tls.sh voice.sadineni.in sadineniabhi@gmail.com
```

This runs certbot's nginx plugin, which rewrites the nginx site to serve
HTTPS on 443 and redirect 80 → 443. Renewal happens automatically via the
`certbot.timer` systemd unit certbot installs — nothing else to set up.

## 5. CI/CD deploys

Run this from your machine (or a CI runner with SSH access) — it SSHes in
for you:

```bash
./scripts/deploy.sh
# or: VM_HOST=abhi@<vm_public_ip> ./scripts/deploy.sh
```

which remotely runs `git pull --ff-only && docker compose -f docker-compose.prod.yml up -d --build`
plus an image prune to keep the small disk from filling up.

## Notes / tradeoffs

- Postgres, backend, and frontend all run as containers on the one VM —
  there's no managed DB, so back it up yourself if the data matters
  (`docker exec` + `pg_dump` to somewhere off-box).
- The static IP (`google_compute_address.static_ip`) only stays free while
  attached to a running instance. `terraform destroy` releases it along with
  the VM, so you won't get charged for an orphaned reserved IP.
- SSH is open to `0.0.0.0/0` by default (`ssh_source_ranges` in
  `variables.tf`) — tighten that to your IP if you want less exposure.
- e2-micro has 1GB RAM. Fine for this POC's traffic, but if backend builds
  or npm builds OOM during `docker compose up --build` on the box itself,
  consider building images elsewhere (e.g. CI) and just `docker compose pull`
  on the VM, or bump to `e2-small` (loses free-tier eligibility, ~$13/mo).
