# MatSci YAMZ — Technical Deployment Overview

This document describes the host environment, services, network, and configuration required to run the MatSci YAMZ application in production. It is intended for system administrators and DevOps staff.

---

## 1. Architecture Summary

MatSci YAMZ is a Next.js 15 application that depends on three external services at runtime:

| Component | Technology | Default Port | Purpose |
|---|---|---|---|
| Web Application | Next.js 15 (Node.js 20/22) | 3000 | Serves the web UI and tRPC API |
| Database | PostgreSQL 15+ | 5432 | Stores users, terms, definitions, votes, comments, tags, LLM chats |
| LLM Service | Ollama (gemma3) | 11434 | Generates AI definitions for material science terms |
| Reverse Proxy | Nginx | 80/443 | TLS termination, forwards to port 3000 |

Authentication is handled via Google OAuth 2.0 with iron-session for encrypted session cookies.

---

## 2. System Requirements (VM)

### Minimum (small user base, local Ollama with gemma3)

| Resource | Value |
|---|---|
| CPU | 2 vCPUs |
| RAM | 4 GB |
| Disk | 20 GB SSD |
| OS | Ubuntu 24.04 LTS or Debian 12+ |

### Recommended (moderate traffic, larger models, resilience headroom)

| Resource | Value |
|---|---|
| CPU | 4 vCPUs |
| RAM | 8–16 GB |
| Disk | 50+ GB SSD |
| OS | Ubuntu 24.04 LTS |

> **Note on RAM:** Ollama loads model weights into memory. The `gemma3` model (4B parameters) requires roughly 3–4 GB of RAM when loaded. If a larger model (e.g., `gemma3:12b` or a future `gemma4`) is used, plan for 8–16 GB for Ollama alone. Offloading Ollama to a separate host (see Section 7) reduces the VM requirements to 2 vCPUs / 2 GB RAM.

---

## 3. Software Stack

### 3.1 Node.js

- **Version:** 20 LTS or 22 LTS
- **Package manager:** pnpm (via Corepack)
- **Runtime:** Next.js standalone or `next start`

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack enable
```

### 3.2 PostgreSQL

- **Version:** 15 or newer
- **Driver:** `pg` (node-postgres) via Drizzle ORM
- **Connection string format:** `postgresql://<user>:<password>@<host>:5432/<database>`

### 3.3 Ollama

- **Version:** Latest stable
- **Model:** `gemma3` (hardcoded in `lib/apis/ollama.ts` as `OllamaModel = "gemma3"`)
- **API:** HTTP REST on port 11434

### 3.4 Nginx

- **Role:** Reverse proxy, TLS termination
- **Listens on:** 80 (redirect to 443) and 443
- **Upstream:** `http://127.0.0.1:3000`

---

## 4. Network Architecture

```
                    Internet
                       │
              ┌────────┴────────┐
              │   Firewall /    │
              │   Security Group│
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              │  Nginx (443)    │  ← TLS termination
              │  Redirect 80→443│
              └────────┬────────┘
                       │ proxy_pass http://127.0.0.1:3000
              ┌────────┴────────┐
              │  Next.js (3000) │  ← Node.js application
              │  systemd service│
              └──┬──────────┬───┘
                 │          │
     ┌───────────┴──┐  ┌───┴────────────┐
     │ PostgreSQL   │  │ Ollama (11434) │
     │ (5432)       │  │ gemma3 model   │
     └──────────────┘  └────────────────┘
```

### Port Reference

| Port | Service | Bound To | Exposed? |
|---|---|---|---|
| 443 | Nginx (HTTPS) | 0.0.0.0 | Yes — public |
| 80 | Nginx (HTTP redirect) | 0.0.0.0 | Yes — public |
| 3000 | Next.js | 127.0.0.1 | No — internal only |
| 5432 | PostgreSQL | 127.0.0.1 (or remote host) | No — internal only |
| 11434 | Ollama | 127.0.0.1 (or remote host) | No — internal only |

### Firewall Rules (UFW example)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp        # SSH
sudo ufw allow 80/tcp        # HTTP (redirect)
sudo ufw allow 443/tcp       # HTTPS
sudo ufw enable
```

---

## 5. Environment Variables

All variables are required. The application reads them at startup via `dotenv/config`.

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://matsci_yamz:secret@127.0.0.1:5432/matsci_yamz` |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID | `xxxxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret | `GOCSPX-xxxxx` |
| `GOOGLE_CALLBACK_URL` | OAuth callback URL (must match Google console) | `https://matsci.yamz.net/api/auth/callback` |
| `SESSION_PASSWORD` | iron-session encryption key (≥32 characters) | random 32+ char string |
| `OLLAMA_HOST` | Ollama API base URL | `http://127.0.0.1:11434` |
| `SYSTEM_PROMPT` | System prompt sent to LLM | See `.env.example` |

> **Security:** Store these in a file with restricted permissions (`chmod 600 .env`) or inject via systemd `EnvironmentFile=`. Never commit `.env` to version control.

---

## 6. Deployment Options

Two deployment strategies are presented below. **Option A (bare VM with systemd)** is the current production approach. **Option B (Docker Compose)** is recommended for easier maintenance and reproducibility.

### Option A: Bare VM with systemd (Current)

The application runs directly on the VM as a systemd service. PostgreSQL and Ollama run as separate system services on the same host (or on remote hosts).

**Pros:**
- Simple, minimal abstraction layers
- Direct access to logs and processes
- Already in use (existing `matsci_yamz.service` file)

**Cons:**
- Manual dependency management
- OS upgrades can break the stack
- Harder to reproduce across environments
- No isolation between services

**Setup steps:**

1. Install OS packages:
```bash
sudo apt-get update
sudo apt-get install -y nginx git curl postgresql
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack enable
curl -fsSL https://ollama.com/install.sh | sh
```

2. Create service user:
```bash
sudo useradd -m -s /bin/bash -G www-data matsci_yamz
```

3. Clone and build:
```bash
sudo -u matsci_yamz -i
cd ~/code
git clone <repo-url> .
pnpm install --frozen-lockfile
cp .env.example .env  # edit with real values
pnpm db:migrate
pnpm build
```

4. Install systemd service:
```bash
sudo cp matsci_yamz.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable matsci_yamz
sudo systemctl start matsci_yamz
```

5. Configure Nginx (see Section 8).

### Option B: Docker Compose (Recommended for Maintainability)

All services run in containers orchestrated by Docker Compose. This provides isolation, reproducibility, and simplified upgrades.

**Pros:**
- Single command to start the entire stack
- Reproducible across environments
- Easy to update individual services
- Built-in restart policies
- Volumes for data persistence
- No host-level Node.js/PostgreSQL installation needed

**Cons:**
- Docker and Docker Compose must be installed
- Slightly more resource overhead (~200 MB RAM for Docker daemon)
- Less direct access to service internals

**`docker-compose.yml` example:**

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    # If Ollama is remote, just set OLLAMA_HOST in .env
    # If Ollama is local (same compose), uncomment depends_on below
    # depends_on:
    #   ollama:
    #     condition: service_healthy

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: matsci_yamz
      POSTGRES_USER: matsci_yamz
      POSTGRES_PASSWORD: replace-me
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U matsci_yamz"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Uncomment if running Ollama locally in the compose stack
  # ollama:
  #   image: ollama/ollama:latest
  #   restart: unless-stopped
  #   ports:
  #     - "127.0.0.1:11434:11434"
  #   volumes:
  #     - ollama-data:/root/.ollama
  #   # GPU support: uncomment and install nvidia-container-toolkit
  #   # deploy:
  #   #   resources:
  #   #     reservations:
  #   #       devices:
  #   #         - driver: nvidia
  #   #           count: 1
  #   #           capabilities: [gpu]

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - app

volumes:
  pgdata:
  # ollama-data:
```

**`Dockerfile` example:**

```dockerfile
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
RUN corepack enable
WORKDIR /app
COPY --from=builder /app ./
EXPOSE 3000
CMD ["pnpm", "start"]
```

**Startup:**

```bash
docker compose up -d
# To pull the model into the Ollama container (if local):
# docker compose exec ollama ollama pull gemma3
```

---

## 7. Service Placement Alternatives

### 7.1 Database: Local vs. Drexel's Main PostgreSQL

| | Local PostgreSQL | Drexel's Main PostgreSQL |
|---|---|---|
| **Setup** | Install on VM or use Docker container | Request access from Drexel DBA team |
| **Connection** | `127.0.0.1:5432` | Drexel-provided host and credentials |
| **Maintenance** | You manage backups, upgrades, tuning | Drexel DBA team manages infrastructure |
| **Isolation** | Fully isolated, no shared resources | Shared infrastructure, potential noisy-neighbor |
| **Resilience** | Depends on your backup strategy | Benefits from Drexel's enterprise backup/HA |
| **Network** | Local socket — lowest latency | Network hop to Drexel infrastructure |
| **Cost** | VM resources for PostgreSQL | No additional compute cost |
| **Access control** | Full control over users/roles | Must follow Drexel's DB policies |

**Recommendation:** If Drexel's PostgreSQL team can provide a dedicated database with appropriate connection limits and backup guarantees, using Drexel's main PostgreSQL **reduces operational burden** and improves resilience. If the Drexel DBA team cannot guarantee responsive access or sufficient connection limits, a local PostgreSQL (in Docker or bare) is more reliable.

**To use Drexel's PostgreSQL:** Simply set `DATABASE_URL` to the Drexel-provided connection string. No code changes are required — Drizzle ORM connects to any PostgreSQL instance.

### 7.2 Ollama: Local vs. Remote Server

| | Local Ollama (same VM) | Remote Ollama (separate server) |
|---|---|---|
| **Setup** | Install on VM | Install on a dedicated GPU/server host |
| **Model storage** | Consumes VM disk (gemma3 ~2–5 GB) | Consumes remote host disk |
| **RAM impact** | 3–4 GB for gemma3, 8–16 GB for larger models | No impact on app VM |
| **Latency** | Lowest (localhost) | Network round-trip (~1–5 ms on LAN) |
| **Scalability** | Competes with app for CPU/RAM | Can scale independently, add GPU |
| **Maintenance** | You manage Ollama upgrades and model pulls | Ollama admin manages separately |
| **Resilience** | Single point of failure on VM | Can be load-balanced or failover-configured |

**Recommendation:** For the current `gemma3` model with light-to-moderate usage, **local Ollama is simplest**. If you plan to upgrade to a larger model (e.g., `gemma3:12b`, a future `gemma4`, or Llama-class models), **offload Ollama to a dedicated server with a GPU** to avoid starving the web application of memory.

**To use a remote Ollama:** Set `OLLAMA_HOST` to the remote server's URL (e.g., `http://10.0.0.50:11434`). Ensure the remote Ollama is configured to listen on the network interface reachable from the app VM (by default Ollama binds to `127.0.0.1`; set `OLLAMA_HOST=0.0.0.0` on the remote server).

**Model upgrade note:** The model name is hardcoded in `lib/apis/ollama.ts` as `OllamaModel = "gemma3"`. To change the model (e.g., to `gemma4`), update this constant and restart the application. No database migration is needed.

---

## 8. Nginx Reverse Proxy Configuration

### Example: `/etc/nginx/sites-available/matsci-yamz`

```nginx
server {
    listen 80;
    server_name matsci.yamz.net;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name matsci.yamz.net;

    ssl_certificate     /etc/letsencrypt/live/matsci.yamz.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/matsci.yamz.net/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### TLS Certificate (Let's Encrypt)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d matsci.yamz.net
```

---

## 9. Process Management (systemd)

The existing `matsci_yamz.service` file runs the application under a dedicated user with automatic restarts.

```ini
[Unit]
Description=MatSci YAMZ Service
After=network.target multi-user.target

[Service]
EnvironmentFile=/home/matsci_yamz/code/.env
WorkingDirectory=/home/matsci_yamz/code
User=matsci_yamz
Group=www-data
ExecStart=/bin/bash -c 'pnpm start'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> **Note:** The original service file has an empty `Environment=""` line. Replace it with `EnvironmentFile=` pointing to your `.env` file, or inject variables via your secrets manager.

### Useful commands

```bash
sudo systemctl start matsci_yamz      # Start
sudo systemctl stop matsci_yamz       # Stop
sudo systemctl restart matsci_yamz    # Restart
sudo systemctl status matsci_yamz     # Check status
journalctl -u matsci_yamz -f          # Tail logs
```

---

## 10. Database Setup

### Local PostgreSQL

```sql
CREATE DATABASE matsci_yamz;
CREATE USER matsci_yamz WITH PASSWORD 'replace-me';
ALTER ROLE matsci_yamz SET client_encoding TO 'utf8';
ALTER ROLE matsci_yamz SET default_transaction_isolation TO 'read committed';
GRANT ALL PRIVILEGES ON DATABASE matsci_yamz TO matsci_yamz;
```

### Migrations

```bash
pnpm db:migrate    # Apply all pending migrations
pnpm db:generate   # Generate a new migration after schema changes (dev only)
pnpm db:studio     # Open Drizzle Studio (visual DB browser)
```

The schema includes 7 tables: `users`, `terms`, `definitions`, `definitionEdits`, `votes`, `comments`, `tags`, `tagsToTerms` (join table), and `chats`.

---

## 11. Security Hardening

- [ ] Run the application as a non-root service account (`matsci_yamz`)
- [ ] Bind Node.js to `127.0.0.1:3000` only — never expose directly to the internet
- [ ] Use Nginx for TLS termination with TLS 1.2+ only
- [ ] Restrict `.env` file permissions to `600`
- [ ] Use a strong `SESSION_PASSWORD` (32+ random characters)
- [ ] Configure PostgreSQL to listen on `127.0.0.1` only (if local)
- [ ] Enable UFW firewall (allow only 22, 80, 443)
- [ ] Set up automatic OS security updates (`unattended-upgrades`)
- [ ] Regularly rotate Google OAuth client secrets
- [ ] Enable SSH key-only authentication, disable password login

---

## 12. Backup Strategy

### PostgreSQL

```bash
# Daily backup (add to cron)
pg_dump matsci_yamz -U matsci_yamz | gzip > /backups/matsci_yamz_$(date +%Y%m%d).sql.gz

# Retain 30 days
find /backups -name "matsci_yamz_*.sql.gz" -mtime +30 -delete
```

If using Docker:

```bash
docker compose exec db pg_dump -U matsci_yamz matsci_yamz | gzip > backups/matsci_yamz_$(date +%Y%m%d).sql.gz
```

### Application Data

- The application is stateless — all state lives in PostgreSQL
- LLM chat history is stored in the `chats` table (backed up with PostgreSQL)
- Ollama models can be re-pulled with `ollama pull gemma3` — no backup needed

---

## 13. Maintenance & Upgrades

### Application Upgrade

```bash
cd /home/matsci_yamz/code
git pull origin main
./scripts/upgrade.sh    # Runs: pnpm i --frozen-lockfile && pnpm db:migrate && pnpm build
sudo systemctl restart matsci_yamz
```

If using Docker:

```bash
git pull origin main
docker compose up -d --build
```

### Ollama Model Update

```bash
ollama pull gemma3    # Pull latest version of the model
# No application restart needed — Ollama hot-reloads the model
```

### OS Updates

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo reboot  # If kernel update requires; systemd will auto-start the app
```

---

## 14. Recommended Configuration Summary

For the best balance of maintainability and resilience:

| Component | Recommendation | Rationale |
|---|---|---|
| Deployment | Docker Compose | Reproducible, easy upgrades, isolated |
| Database | Drexel's main PostgreSQL (if available) | Enterprise backups, DBA support |
| Database fallback | Local PostgreSQL in Docker container | Full control, simple backup |
| Ollama | Local (gemma3) or remote server (larger models) | Depends on model size and traffic |
| Reverse Proxy | Nginx with Let's Encrypt | Free TLS, well-documented |
| Process Manager | Docker restart policy or systemd | Automatic recovery |
| Backups | Daily `pg_dump` + 30-day retention | Simple, reliable |
| Monitoring | Uptime check + log aggregation | Detect outages early |