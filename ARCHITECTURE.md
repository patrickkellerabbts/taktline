# Architektur

Diese Datei skizziert die größeren Design-Entscheidungen die Taktline
prägen — gedacht für Engineering-Neugierige die das Repo zum ersten Mal
anschauen.

## Warum Next.js + Prisma + GitLab

GitLab CE bietet eine API mit reichhaltigem Issue-Modell, taugt aber nicht
als Gantt-Frontend. Statt einer SaaS-PM-Lösung wollten wir die Daten dort
behalten wo das Team eh schon arbeitet (GitLab), und nur eine ergänzende
Sicht obendrauf bauen. Self-Hosting passt zur Privacy-Anforderung. Stack-
Auswahl:

- **Next.js 16 App Router** — Server Components für die meisten Datenflüsse
  (keine separate API-Schicht nötig), Server Actions für Schreibzugriffe.
- **Prisma 7** — typesafe DB-Layer, Migrations als Code im Repo.
- **Auth.js (NextAuth v5)** mit GitLab OAuth Provider — User-Session lebt
  in PostgreSQL (database strategy), Access-Tokens verschlüsselt zur
  Laufzeit über `@auth/prisma-adapter`-Wrapper.

## `gantt-meta` als Sidecar im Issue-Body

GitLab-Issues kennen nur `due_date`, kein `start_date`. Sie kennen keine
Hierarchie und keine Dependencies. Statt eine zweite Datenquelle aufzubauen
die mit GitLab synchron gehalten werden müsste, hängen wir die fehlenden
Felder als versionierten YAML-Block im HTML-Kommentar an die Issue-
Description an:

```
<reguläre Issue-Description>

<!-- gantt-meta:v1
start_date: 2026-06-01
parent_iid: 42
progress: 30
dependencies:
  - iid: 41
    type: FS
    lag_days: 2
-->
```

Vorteile:
- Im GitLab-UI nur kosmetisch sichtbar (Kommentar), Description-Text bleibt
  lesbar.
- Format ist offen + dokumentiert ([AGENTS.md](./AGENTS.md)) — `glab` CLI,
  Scripts oder KI-Agenten können das genauso editieren wie die App.
- Versionierter Header (`:v1`) erlaubt zukünftige Schema-Migrationen ohne
  alte Reader zu brechen.
- Kanonische Parser-Implementierung in `src/lib/gitlab/meta.ts` (Zod-Schema +
  Serializer + Stripper).

## Bidirectional Sync — Webhook + Reconciliation + Echo-Schutz

Zwei Sync-Richtungen:

**GitLab → App:**
- **Webhook** (`/api/gitlab/webhook`) für Live-Updates: jede Issue-Änderung
  löst `applyIssueUpdate` aus.
- **Reconciliation-Job** alle 15 min (`src/instrumentation.ts` → `setInterval`),
  fängt verlorene Webhooks ab (Network-Ausfall, Container-Restart).

**App → GitLab:**
- Server Actions schreiben direkt über `@gitbeaker/rest` mit dem OAuth-Token
  des Users (`getGitlabClientForUser`).

**Echo-Schutz:** Wenn die App nach GitLab pusht, fires GitLab einen Webhook
zurück. Ohne Schutz würde das die App in eine Sync-Loop schicken. Lösung:
`src/lib/gitlab/self-push.ts` — eine in-memory LRU mit 10-Sekunden-TTL.
Vor jedem Push markiert die App `(iid, projectId)`; der Webhook-Receiver
ignoriert Events deren Issue-IID kürzlich markiert wurde.

## Custom SVG-Gantt — keine Library

Kommerzielle und Open-Source-Gantt-Libraries hatten alle Show-Stopper:

- `wx-react-gantt` — GPLv3, inkompatibel mit unserem Wunsch nach MIT-
  Outbound. Ältere Versionen waren BSD aber nutzten React 18 internals
  (`__SECRET_INTERNALS_DO_NOT_USE_*`) die in React 19 / Next 16 nicht
  mehr existieren.
- DHTMLX, Bryntum — kommerzielle Lizenzen.
- Diverse kleinere — zu starr für Custom-Branding oder schwerfällig für
  React 19.

Stattdessen: eigene SVG-Renderer in `src/components/gantt/GanttView.tsx`.
Pure React, ohne externe Dependencies außer Lucide-Icons. Vorteile:
- Volle Kontrolle über Layout, Drag&Drop, Selection, Picker-Modus.
- React 19 / Next 16 Ready.
- MIT-frei.
- Optimiert für unser Datenmodell (Hierarchie + Dependencies +
  Critical-Path-Halo).

Trade-off: kein Out-of-the-Box-Feature wie z.B. Baseline-Vergleich oder
Resource-Leveling — alles was wir brauchen, müssen wir selbst bauen.

## Critical Path Method (CPM)

`src/lib/gantt/critical-path.ts`: Backward-Pass über FS-Dependencies um
für jeden Task einen `slack` zu berechnen. Tasks mit Slack ≤ 1 Tag gelten
als kritisch und werden im Gantt mit rotem Halo + roten Pfeil-Markern
hervorgehoben. Nur FS-Edges werden im CPM-Graph berücksichtigt (SS/FF/SF
sind im Critical-Path-Sinn weniger eindeutig).

## Token-Verschlüsselung

OAuth-Access-Tokens (und Refresh-Tokens) liegen in der `Account`-Tabelle
verschlüsselt mit AES-256-GCM (`src/lib/auth/crypto.ts`). Key kommt aus
`TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`). Der `PrismaAdapter`
von `@auth/prisma-adapter` wird in `src/lib/auth/encrypted-adapter.ts`
gewrappt: alle write-paths gehen durch `encryptToken`, alle read-paths
durch `decryptToken`. Refresh-Flow ist transparent eingebaut.

## Hierarchie + Summary-Tasks

Parent ↔ Child wird über `WorkPackage.parentId` (FK auf sich selbst)
gespeichert. Wenn ein WP mindestens ein Kind hat, wird `isSummary=true`
gesetzt — Summary-Tasks zeigen aggregierte Dates und Progress aus ihren
Kindern (gewichteter Durchschnitt).

Da GitLab das Konzept nicht kennt, wird zusätzlich ein `gantt::summary`-
Label in GitLab gesetzt, damit auch direkte Issue-Reader das Konstrukt
verstehen.

## Self-Sync vs. External-Sync — was gewinnt?

Wenn ein Konflikt zwischen App und GitLab entsteht (z.B. App schreibt
einen neuen `start_date`, gleichzeitig setzt jemand einen anderen Wert
direkt in GitLab):

- **GitLab gewinnt** beim nächsten Sync — wir haben kein optimistic
  locking auf der Description-Ebene.
- Vermeidung: die App pusht "immediately and only its own change",
  Webhooks holen extern getroffene Änderungen sofort.

## Verzeichnis-Struktur

```
src/
  app/                  # App Router - Routes + Server Components
    api/                # REST endpoints (webhook, admin/reconcile, search, ...)
    projects/[id]/      # Per-Project-Pages + Actions
    reports/            # Dashboard + Cross-Project-Overview
    resources/          # Auslastungs-Heatmap
    about/              # Build-Info
    login/              # Auth.js Login-Page
  components/
    gantt/              # Gantt-Renderer + Inspector
    header/             # AppHeader-Subcomponents (Bell, Search, UserMenu)
    layout/             # AppHeader, MinWidthGate, SubHeader
    resources/          # Heatmap
    reports/            # Donut + Lists
    brand/              # TaktMark Logo
  lib/
    auth/               # crypto + encrypted-adapter + signOut-Action
    gantt/              # CPM, dependency-validation, summary-aggregation
    gitlab/             # client, sync, webhook, reconciliation, meta
    hooks/              # useMediaQuery
    notifications.ts    # Bell-Backend
    preferences.ts      # User-Prefs
    reports.ts          # Reports-Backend
    resources.ts        # Resource-Matrix
    search.ts           # Cmd+K Backend
    db.ts               # Prisma singleton
    logger.ts           # pino
  auth.ts               # NextAuth-Config
  instrumentation.ts    # Startup-Hook (Reconciliation-Scheduler)
prisma/
  schema.prisma         # Datenmodell
  migrations/           # Migration-History
```

## Lese-Links

Personen ohne GitLab-Konto (z.B. Dozenten) bekommen über `/share/<token>` Lesezugriff
auf genau ein Projekt: Gantt, Board, Sprints, Berichte und Ressourcen, aber keine Risiken.

- **Keine Session:** Gäste sind keine Benutzer. Alle Server Actions verlangen `auth()`
  und lehnen sie deshalb von selbst ab. Der Nur-Lese-Modus der Ansichten (`readOnly`)
  sorgt nur dafür, dass nichts Bearbeitbares angeboten wird.
- **Token:** 256 Bit Zufall, in der DB liegt nur der SHA-256-Hash (`ShareLink`). Der Link
  wird einmal angezeigt und lässt sich danach nur widerrufen, nicht erneut abrufen.
- **Verwaltung:** Anlegen, Auflisten und Widerrufen prüft die Maintainer-Rolle in GitLab.
  Scheitert die Prüfung, gibt es keinen Zugriff.
- **Keine GitLab-URLs:** Merge Requests und Avatare gehen nicht an Gäste.
- **Erreichbarkeit:** Der Link wird aus `AUTH_URL` gebaut. Gäste brauchen Zugriff auf die
  Taktline-Instanz selbst, das GitLab muss für sie nicht erreichbar sein.
