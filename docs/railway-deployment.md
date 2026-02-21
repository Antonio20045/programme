# Railway Deployment — KI-Assistent Gateway + PostgreSQL

## Voraussetzung

- DB-6 abgeschlossen, alle Tests gruen
- Railway Account erstellt + Kreditkarte hinterlegt
- Anthropic API Key bereit
- Railway CLI installiert: `npm i -g @railway/cli && railway login`

> **Wichtig:** `packages/gateway/` ist in `.gitignore` (Fork-Management).
> GitHub-basiertes Deployment funktioniert daher NICHT.
> Stattdessen: Railway CLI (`railway up`) aus dem lokalen Repo.

## Schritt 1: Railway Projekt erstellen

1. https://railway.app → **New Project** → **Empty Project**
2. Railway CLI verbinden:
   ```bash
   cd /pfad/zum/repo
   railway link
   ```
3. Das Projekt auswählen das du gerade erstellt hast

## Schritt 2: PostgreSQL hinzufügen

1. Im Railway Dashboard: **+ New** → **Database** → **PostgreSQL**
2. Railway erstellt automatisch eine `DATABASE_URL` Variable
3. Diese wird automatisch an deinen Gateway-Service durchgereicht

## Schritt 3: Environment Variables setzen

Im Railway Dashboard → Gateway Service → **Variables**:

```bash
# LLM (Pflicht — mindestens einer)
ANTHROPIC_API_KEY=sk-ant-dein-key
# OPENROUTER_API_KEY=sk-or-...          # Optional: alternativer LLM-Provider

# Auth
OPENCLAW_GATEWAY_TOKEN=<zufaelliger-string>

# Encryption (AES-256-GCM fuer OAuth tokens in DB)
# Generieren: openssl rand -hex 32
TOKEN_ENCRYPTION_KEY=<64-hex-chars>

# Clerk (optional — ohne Clerk laeuft Gateway im Local-Modus)
# CLERK_SECRET_KEY=sk_...
# CLERK_WEBHOOK_SECRET=whsec_...

# Stripe (optional — nur fuer Billing)
# STRIPE_SECRET_KEY=sk_test_...
# STRIPE_WEBHOOK_SECRET=whsec_...

# Google OAuth (optional — nur fuer Gmail/Calendar Tools)
# GOOGLE_CLIENT_ID=...
# GOOGLE_CLIENT_SECRET=...
```

**NICHT setzen** — Railway setzt diese automatisch:
- `DATABASE_URL` (kommt von PostgreSQL Service)

**NICHT setzen** — nur fuer lokales docker-compose relevant:
- `GATEWAY_BIND` (im Dockerfile bereits `lan`)
- `GATEWAY_PORT` (kontrolliert nur docker-compose Host-Port-Mapping)
- `POSTGRES_PASSWORD` (Railway PostgreSQL hat eigene Credentials)

## Schritt 4: Build-Konfiguration

Die `railway.toml` im Repo konfiguriert den Build automatisch:
- Dockerfile: `docker/gateway.Dockerfile`
- Health Check: `/health`

**Settings → Networking:**
- Public Networking: **Enabled**
- Port: **18789** (muss manuell gesetzt werden — OpenClaw nutzt `OPENCLAW_GATEWAY_PORT`, nicht Railwayss `$PORT`)
- Railway generiert eine URL: `ki-assistent-gateway-production.up.railway.app`

## Schritt 5: Deploy

Da `packages/gateway/` nicht in Git ist, deployst du mit der Railway CLI:

```bash
cd /pfad/zum/repo
railway up
```

Erster Deploy dauert 3-5 Minuten (Docker Build + npm install).

Fuer folgende Deploys nach Code-Aenderungen:
```bash
railway up
```

> **Tipp:** Automatische Deploys kannst du spaeter mit einer CI/CD Pipeline umsetzen
> die `railway up` ausfuehrt (z.B. GitHub Actions mit dem Gateway als Build-Artefakt).

## Schritt 6: Verifizieren

```bash
# Health Check
curl https://deine-railway-url.up.railway.app/health

# Railway Logs pruefen
railway logs
```

In den Logs sollte erscheinen:
- `[in-app] database migrations applied` — DB-Migration erfolgreich
- `[in-app] channel ready — waiting for HTTP connections` — Gateway bereit

## Schritt 7: Webhooks konfigurieren

### Clerk Webhook:
1. Clerk Dashboard → **Webhooks** → **Add Endpoint**
2. URL: `https://deine-railway-url.up.railway.app/webhooks/clerk`
3. Events: `user.created`, `user.updated`, `user.deleted`

### Stripe Webhook:
1. Stripe Dashboard → **Developers** → **Webhooks** → **Add Endpoint**
2. URL: `https://deine-railway-url.up.railway.app/webhooks/stripe`
3. Events: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`

## Schritt 8: Desktop App auf Server umstellen

In der Desktop App:
- Settings → Gateway-Modus → **Server**
- Server-URL: `https://deine-railway-url.up.railway.app`
- Die App verbindet sich dann per WebSocket fuer den Desktop Agent

## Kosten (geschaetzt)

| Service | Preis |
|---------|-------|
| Gateway (512MB RAM) | ~$5/Mo |
| PostgreSQL (1GB) | ~$5/Mo |
| **Gesamt Start** | **~$10/Mo** |

Skaliert automatisch. Bei 10.000+ Usern: ~$50-100/Mo.

## Production-Empfehlungen

- **Custom Domain:** Railway Settings → Custom Domain → eigene Domain verbinden
- **DB Backups:** Railway PostgreSQL Backups aktivieren (kostenpflichtig, aber fuer Production empfohlen)
- **Monitoring:** Railway Metrics Tab fuer CPU/RAM/Network im Auge behalten

## Lokales Testen mit Docker Compose

Bevor du auf Railway deployst, lokal testen:

```bash
# Env-Variablen vorbereiten
cp docker/env-example .env
# .env Datei oeffnen und Werte eintragen

# Stack starten
docker compose up -d

# Logs verfolgen
docker compose logs -f gateway

# Health Check
curl http://localhost:18789/health

# Stack stoppen
docker compose down
```

## Troubleshooting

**Build schlaegt fehl:**
- `railway logs` oder Railway Dashboard → Deployments → letzter Deploy → Logs
- Meistens: fehlende Environment Variable oder Dockerfile Pfad falsch

**502 Bad Gateway:**
- Gateway startet noch → 30s warten
- Health Check URL im Browser pruefen
- Port in Railway Networking auf 18789 gesetzt?

**Migration fehlgeschlagen:**
- Logs pruefen auf: `[in-app] migration warning: ...`
- `DATABASE_URL` korrekt? Format: `postgresql://user:pass@host:5432/dbname`
- PostgreSQL Service laeuft? Railway Dashboard → PostgreSQL → Logs

**WebSocket verbindet nicht:**
- Port 18789 in Railway Networking konfiguriert?
- Public Networking aktiviert?
- HTTPS URL in der Desktop App (nicht HTTP)?
