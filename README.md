# Taktline — Gantt-Chart Webapp

Projektmanagement-Tool als Bridge zwischen GitLab CE und vollwertiger PM-Software. Liest Issues + Milestones aus GitLab, ergänzt sie um Gantt-spezifische Planungsdaten (Start-Dates, Dependencies, Hierarchie, Resource-Allocation) und visualisiert alles als interaktives Gantt-Chart.

> **Status:** Single-Tenant Internal-Tool, im produktiven Einsatz. Hier öffentlich als Portfolio-/Beispiel-Repo. Vollständige Anforderungen siehe [`REQUIREMENTS.md`](./REQUIREMENTS.md), Design-Vorgaben in [`DESIGN_BRIEF.md`](./DESIGN_BRIEF.md), Architektur-Notizen in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

**→ Live-Demo: [taktlinedemo.da2o.xyz](https://taktlinedemo.da2o.xyz/)** — ohne Anmeldung, alles anfassbar. Balken verschieben, Termine und Fortschritt ändern, Aufgaben und Risiken anlegen, kommentieren. Alle Besucher teilen sich einen Datenstand, der sich stündlich auf die Beispieldaten zurücksetzt.

![Gantt-Ansicht mit Hierarchie, Dependency-Pfeilen und Inspector](docs/screenshots/gantt-overview.png)

<details>
<summary>Weitere Ansichten: Risikomatrix, Ressourcen, Berichte</summary>

**Risikomatrix** — 5×5 nach Wahrscheinlichkeit und Auswirkung, Karten per Drag-and-Drop verschiebbar, umschaltbar zwischen Pre- und Post-Mitigation:

![Risikomatrix](docs/screenshots/risk-matrix.png)

**Ressourcen** — Auslastung pro Person und Kalenderwoche:

![Ressourcen-Heatmap](docs/screenshots/resources.png)

**Berichte** — Fortschritt, offene Konflikte, Velocity und Meilenstein-Status:

![Berichte](docs/screenshots/reports.png)

</details>

> Alle Screenshots zeigen das mitgelieferte Demo-Projekt — erfundene Daten, siehe [Demo-Umgebung](#demo-umgebung--screenshots).

---

## Features

- **GitLab-SSO** via OAuth2 gegen self-hosted GitLab CE
- **Issue-Sync** mit zwei Richtungen:
  - GitLab → App: Issues + Milestones (inkl. closed) automatisch geholt
  - App → GitLab: Edits werden direkt zurück nach GitLab geschrieben
- **Custom Gantt-Chart** (eigene SVG-Implementierung, kein Vendor-Lock-in):
  - Zoom Tag / Woche / Monat / Quartal mit auto-fit
  - Hierarchie / Tree-View mit Expand/Collapse + Summary-Bars
  - Dependency-Pfeile (FS / SS / FF / SF) mit Elbow-Paths
  - Drag & Drop + Resize von Bars
  - Inspector-Panel mit allen Editier-Funktionen
  - Klick-Picker für Parent und Dependencies
- **Editierbar im Inspector:** Titel, Start/Ende, Progress, Status, Zuständige, Labels, Parent, Vorgänger
- **Erstellung neuer Aufgaben** direkt aus der App (legt GitLab-Issue + lokales Work Package an)
- **Webhook-Receiver** für Live-Updates aus GitLab (siehe [Deployment](#deployment))

---

## Tech-Stack

| Schicht | Wahl |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Datenbank | PostgreSQL 16 |
| ORM | Prisma 7 mit pg-Driver-Adapter |
| Auth | Auth.js (NextAuth v5) mit GitLab OAuth Provider |
| GitLab Client | `@gitbeaker/rest` |
| UI | Tailwind v4 + Custom-Klassen (Taktline Theme) |
| Icons | Lucide-React |
| Fonts | Inter + JetBrains Mono (via `next/font`) |
| Logger | Pino |

---

## Setup (Development)

### 1. Voraussetzungen

- Node.js ≥ 22
- Docker + docker-compose (für lokales Postgres)
- Zugang zu einer GitLab-Instanz (Self-Hosted GitLab CE oder gitlab.com)

### 2. OAuth Application in GitLab anlegen

Einmalig durch einen GitLab-Admin (oder über die User-Settings für eine persönliche Application):

1. `https://<deine-gitlab-instanz>/admin/applications` → "New application"
2. Felder:
   - **Name:** `Taktline (Dev)` oder ähnlich
   - **Redirect URI:** `http://localhost:3043/api/auth/callback/gitlab`
   - **Trusted:** optional (überspringt User-Consent-Dialog)
   - **Confidential:** ☑
   - **Scopes:** `read_user`, `api`
3. **Application ID** + **Secret** kopieren

### 3. Repository clonen + Dependencies

```bash
git clone https://github.com/patrickkellerabbts/taktline.git
cd taktline
npm install
```

### 4. Environment konfigurieren

`.env` anlegen (gitignored) basierend auf `.env.example`:

```bash
cp .env.example .env
```

Folgende Werte setzen:

```env
# Datenbank — passt zu docker-compose.yml
DATABASE_URL="postgresql://gantt:gantt@localhost:5433/gantt?schema=public"

# Auth.js (Secret-Generierung: openssl rand -base64 32)
AUTH_SECRET="..."
AUTH_URL="http://localhost:3043"

# GitLab OAuth
GITLAB_URL="https://gitlab.example.com"
GITLAB_CLIENT_ID="<aus Schritt 2>"
GITLAB_CLIENT_SECRET="<aus Schritt 2>"

# Token-Verschlüsselung in DB (openssl rand -base64 32)
TOKEN_ENCRYPTION_KEY="..."

LOG_LEVEL="debug"
NODE_ENV="development"
```

### 5. Postgres starten + Schema migrieren

```bash
npm run db:up           # Postgres-Container hochfahren
npm run db:push         # Schema in DB schreiben
npm run db:generate     # Prisma-Client generieren
```

### 6. Dev-Server starten

```bash
npm run dev
```

Öffne **http://localhost:3043** im Browser → Login mit GitLab.

---

## Scripts

| Script | Zweck |
|---|---|
| `npm run dev` | Next.js Dev-Server auf Port 3043 |
| `npm run build` | Production-Build |
| `npm run start` | Production-Server starten (Port 3043) |
| `npm run lint` | ESLint Check |
| `npm run db:up` | Postgres-Docker starten |
| `npm run db:down` | Postgres-Docker stoppen |
| `npm run db:push` | Prisma-Schema zur DB pushen (ohne Migration-File) |
| `npm run db:migrate` | Migration generieren + anwenden (Production-Style) |
| `npm run db:studio` | Prisma Studio (DB-GUI) im Browser |
| `npm run db:generate` | Prisma Client neu generieren |
| `npm run demo:reset` | Demo-DB neu anlegen + migrieren |
| `npm run demo:seed` | Demo-Daten schreiben (siehe unten) |
| `npm run demo:dev` | Dev-Server gegen die Demo-DB |
| `npm run demo:screenshots` | Doku-Screenshots neu erzeugen |

---

## Demo-Umgebung & Screenshots

Die Bilder oben stammen nicht aus einem echten Projekt, sondern aus einem
Seed mit frei erfundenen Daten. Der gleiche Seed ist auch praktisch, um die
App ohne GitLab-Zugang anzuschauen: er legt ein Beispielprojekt mit 26
Aufgaben, Hierarchie, Dependencies, Meilensteinen, Auslastung und Risiken an —
plus eine Session, die den OAuth-Login überspringt.

Alles läuft gegen eine **separate Datenbank** (`taktline_demo`) im selben
Postgres-Container. Die Dev-DB bleibt unangetastet.

```bash
npm run db:up          # Postgres, falls noch nicht läuft
npm run demo:reset     # Demo-DB anlegen + Schema migrieren
npm run demo:seed      # Beispieldaten schreiben
npm run demo:dev       # Dev-Server gegen die Demo-DB (Port 3043)
```

Danach ist **http://localhost:3043** ohne Login als Demo-Nutzerin bedienbar.

Screenshots neu erzeugen (Dev-Server aus dem letzten Schritt muss laufen):

```bash
npx playwright install chromium   # einmalig
npm run demo:screenshots          # schreibt nach docs/screenshots/
```

Was wo definiert ist:

| Datei | Inhalt |
|---|---|
| [`scripts/seed-demo.ts`](scripts/seed-demo.ts) | Beispieldaten — Personen, Aufgaben, Dependencies, Risiken |
| [`scripts/screenshots.ts`](scripts/screenshots.ts) | Welche Seiten aufgenommen werden, Fenstergrössen, Vorbereitungsschritte |
| [`scripts/demo-constants.ts`](scripts/demo-constants.ts) | Session-Token + Projekt-ID, die beide Scripts teilen |

Der Seed ist bewusst destruktiv: er leert die Demo-DB vor jedem Lauf und
setzt ein festes Bezugsdatum, damit wiederholte Läufe identische Bilder
liefern.

### Als öffentliche Demo betreiben

Läuft unter **[taktlinedemo.da2o.xyz](https://taktlinedemo.da2o.xyz/)**.

Mit `DEMO_MODE=true` läuft die App ganz ohne GitLab: ein lokaler Stub
beantwortet die API-Aufrufe, der Login wird übersprungen und die
Beispieldaten setzen sich periodisch zurück. Alle Schreibpfade — Drag-and-Drop,
Inspector, neue Aufgaben, Kommentare — funktionieren dabei normal.

Deployment, Reverse-Proxy und Betrieb: [`DEMO.md`](./DEMO.md).

```bash
npm run demo:dev   # lokal, mit DEMO_MODE=true
```

---

## Projekt-Struktur

```
src/
├── auth.ts                          NextAuth v5 Config + GitLab Provider
├── app/
│   ├── layout.tsx                   Root Layout (Inter + JetBrains Mono)
│   ├── login/page.tsx               SSO-Login-Page
│   ├── projects/
│   │   ├── page.tsx                 Projekt-Liste
│   │   ├── activate/                Projekt aus GitLab aktivieren
│   │   └── [id]/
│   │       ├── ResyncButton.tsx     Manuelle Re-Sync
│   │       ├── actions.ts           resyncProjectAction
│   │       └── gantt/
│   │           ├── page.tsx         Gantt-Hauptscreen
│   │           ├── NewTaskButton.tsx
│   │           └── actions.ts       updateWorkPackageAction, createWorkPackageAction
│   └── api/
│       ├── auth/[...nextauth]/      Auth.js Handler
│       └── gitlab/webhook/          Webhook-Receiver für GitLab-Events
├── components/
│   ├── gantt/
│   │   ├── GanttView.tsx            SVG-Gantt mit Ribbon, Zoom, D&D
│   │   ├── Inspector.tsx            Side-Panel mit Editor
│   │   └── AssigneeAvatars.tsx
│   ├── brand/                       TaktMark, GitlabMark
│   └── layout/AppHeader.tsx         Top-Bar + Sub-Header
├── lib/
│   ├── auth/                        AES-GCM Token-Verschlüsselung, OAuth-Refresh
│   ├── db/                          Prisma Client mit pg-Adapter
│   ├── gitlab/
│   │   ├── client.ts                Gitbeaker mit User-Token
│   │   ├── meta.ts                  YAML-HTML-Comment Parser/Serializer
│   │   ├── projects.ts              Projekt-Listing
│   │   ├── webhooks.ts              GitLab-Webhook-Erstellung
│   │   ├── webhook.ts               Token-Verify + Payload-Types
│   │   ├── self-push.ts             Echo-Schutz für eigene Pushes
│   │   └── sync.ts                  Initial-Sync + applyIssueUpdate
│   ├── gantt/summary.ts             Rekursive Summary-Aggregation
│   ├── i18n/de.ts                   UI-Strings (Deutsch)
│   └── logger.ts                    Pino mit pretty-print im Dev
└── types/auth.d.ts                  NextAuth User-Type-Augmentation

prisma/
└── schema.prisma                    Datenmodell (siehe REQUIREMENTS Sektion 6)
```

---

## GitLab-Integration

Diese App ergänzt GitLab um Planungs-Daten, die GitLab CE nativ nicht kennt (Start-Date, Dependencies, Hierarchie, Resource-Allocation, Progress). Diese Felder werden als **YAML-Block in einem HTML-Kommentar** an die Issue-Description angehängt — sichtbar für Menschen die das Issue in GitLab anschauen, ignorierbar wenn man's nicht braucht.

Format-Spec für direktes Editieren via `glab` CLI, REST-API oder KI-Agenten: siehe [`AGENTS.md`](./AGENTS.md).

---

## Deployment

### Production via docker-compose

Auf der Deploy-VM (Linux mit Docker + docker-compose):

```bash
# 1. Repo holen
git clone https://github.com/patrickkellerabbts/taktline.git
cd taktline

# 2. Env vorbereiten
# docker-compose liest standardmäßig die .env aus dem aktuellen Verzeichnis.
# Werte aus .env.production.example als Referenz übernehmen und anpassen:
cp .env.production.example .env
# Werte setzen: POSTGRES_PASSWORD, AUTH_URL (öffentliche URL via Traefik),
#               AUTH_SECRET, TOKEN_ENCRYPTION_KEY, GITLAB_*, RECONCILIATION_SECRET
# Secrets generieren: openssl rand -base64 32   (RECONCILIATION_SECRET: openssl rand -hex 32)

# 3. Build + Start (BUILD_SHA für die /about-Seite reinreichen)
BUILD_SHA=$(git rev-parse --short HEAD) docker compose -f compose.prod.yml up -d --build

# 4. Logs prüfen
docker compose -f compose.prod.yml logs -f app
```

Der Container-Entrypoint führt automatisch `prisma migrate deploy` aus, bevor der Next.js-Server startet. Beim ersten Start erzeugt das alle Tabellen; bei späteren Deploys werden nur neue Migrations angewendet.

Der `BUILD_SHA` ist optional — fehlt er, zeigt die /about-Seite "unknown". Das `.git`-Verzeichnis ist in `.dockerignore` (kein Bloat im Build-Context), darum reichen wir den SHA als Build-Arg vom Host durch.

**Update-Workflow** (für Code-Änderungen ohne Schema-Änderung):

```bash
git pull
BUILD_SHA=$(git rev-parse --short HEAD) docker compose -f compose.prod.yml up -d --build
```

Oder einfach `npm run prod:up` — das wrappt den BUILD_SHA-Aufruf bereits.

Bei neuen Env-Variablen (z.B. nach einem Schema-Update) erst die `.env` ergänzen, dann obigen Befehl. Compose erkennt geänderte Env-Werte und re-created den Container.

Convenience-Scripts (führen die `compose.prod.yml`-Variante aus):

```bash
npm run prod:build      # Image neu bauen
npm run prod:up         # Stack starten (im Hintergrund)
npm run prod:down       # Stack stoppen
npm run prod:logs       # App-Logs streamen
```

### GitLab OAuth Application für Production

Entweder eine **neue OAuth Application** in GitLab Admin anlegen mit Redirect-URI `${AUTH_URL}/api/auth/callback/gitlab`, oder bei der Dev-Application eine zweite Redirect-URI ergänzen.

### Traefik / Reverse-Proxy

Die App lauscht intern auf Port 3043 (HTTP). Traefik routet die öffentliche Domain auf den Container. Beispiel-Labels:

```yaml
# In compose.prod.yml unter dem app-Service, falls Traefik die Labels nutzt:
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.taktline.rule=Host(`taktline.intern.example`)"
  - "traefik.http.services.taktline.loadbalancer.server.port=3043"
```

### Webhooks für Live-Sync aktivieren

Damit GitLab Issue-Änderungen direkt pushen kann:

- Beim **Projekt-Aktivieren** in der App wird der Webhook automatisch in GitLab angelegt (sofern `AUTH_URL` öffentlich erreichbar ist).
- Falls das fehlschlägt (z.B. weil GitLab in den Network-Settings "Outbound requests to local network endpoints" blockiert): in GitLab unter Admin → Settings → Network einschalten.
- Manuell anlegen: GitLab → Projekt → Settings → Webhooks
  - URL: `${AUTH_URL}/api/gitlab/webhook`
  - Secret: aus `projects.webhookSecretEncrypted` in der DB (decrypten mit `TOKEN_ENCRYPTION_KEY`)
  - Events: ☑ Issues events, ☑ Confidential issues events

### Reconciliation-Job (Auto-Sync alle 15 Min)

Sicherheitsnetz für verlorene Webhooks (Network-Ausfall, Container-Restart, Maintenance). Beim Server-Start (`instrumentation.ts`) wird ein Interval registriert, das alle 15 Min `performInitialSync` gegen jedes Projekt fährt. Token kommt vom User, der das Projekt aktiviert hat (`Project.activatedByUserId`).

**Env-Variablen:**

```env
RECONCILIATION_ENABLED=true           # default true
RECONCILIATION_INTERVAL_MINUTES=15    # default 15
RECONCILIATION_SECRET=<openssl rand -hex 32>   # optional, für manuellen Trigger
```

**Manuell triggern (Test ohne 15 Min Wartezeit):**

```bash
# Alle Projekte
curl -X POST -H "Authorization: Bearer $RECONCILIATION_SECRET" \
  ${AUTH_URL}/api/admin/reconcile

# Einzelnes Projekt
curl -X POST -H "Authorization: Bearer $RECONCILIATION_SECRET" \
  "${AUTH_URL}/api/admin/reconcile?projectId=<uuid>"
```

Logs erscheinen im Container-Stdout mit `action: project.reconcile` in der AuditLog-Tabelle.

### Migrations bei Schema-Änderungen

```bash
# Dev: neues Migration-File erzeugen (DB wird nicht angefasst, --create-only)
npm run db:migrate:create -- --name <kurzer-name>

# Commit der prisma/migrations/<timestamp>_<name>/migration.sql File
# Beim nächsten Production-Deploy läuft `migrate deploy` im Container und wendet die Migration an.
```

### Cross-Arch Build

Wenn du auf Mac (ARM) baust und der Server x86_64 ist:

```bash
docker buildx build --platform linux/amd64 -t taktline:latest --load .
```

Oder einfach direkt auf der VM bauen (`prod:build` lokal auf der VM).

---

## Architektur-Entscheidungen

Detaillierte Begründungen in [`REQUIREMENTS.md`](./REQUIREMENTS.md):

- **GitLab als Source of Truth** für alle Felder die GitLab kennt; eigene DB ergänzt nur die Gantt-spezifischen Felder
- **`gantt-meta` YAML-Block** in Issue-Descriptions speichert Start-Dates, Hierarchie, Dependencies — DB ist Master, GitLab ist Spiegel + Backup
- **Tokens AES-GCM-verschlüsselt** in der DB at rest (siehe FR-A3)
- **Self-Push-Echo-Schutz** verhindert Sync-Schleifen wenn die App eigene Änderungen via Webhook zurückbekommt
- **Custom Gantt statt Library** weil verfügbare React-19-kompatible MIT-Libs nicht ausreichten (siehe Memory `nextjs16-bundled-react`)

---

## Lizenz

MIT — siehe [LICENSE](LICENSE). Dependencies & Third-Party-Lizenzen sind in [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) dokumentiert.
