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

### Projektstrukturplan

Der PSP (`/projects/[id]/psp`) ist eine zweite Sicht auf genau diese
Hierarchie, kein eigenes Modell. Bearbeiten läuft über dieselben Actions wie
im Gantt (`createWorkPackageAction`, `updateWorkPackageAction` mit
`parentIid`). Die Codes rechnet `buildPsp` in `lib/psp.ts` bei jedem Aufruf
aus der Reihenfolge der Geschwister (Start, dann IID); die Taktline-CLI
(`psp`) nutzt dieselbe Funktion, damit beide gleich nummerieren. Das
Diagramm ist reines SVG mit festen Farben, damit PNG-, SVG- und PDF-Export
ohne das App-Stylesheet gleich aussehen.

### PDF-Export ohne Browser

Gantt-Druckansicht (`GanttPrintView`) und PSP-Diagramm (`PspDiagram`) sind reines SVG ohne HTML. Die Web-App druckt sie über den Browser; die Taktline-CLI rendert dieselben Komponenten mit `react-dom/server` und macht mit pdfkit und svg-to-pdfkit (beide MIT) ein Vektor-PDF (`scripts/svg-pdf.ts`). Schriften sind die PDF-Standardschriften Helvetica und Courier, eingebettet wird nichts. `paint-order` kennt svg-to-pdfkit nicht; Halos um Beschriftungen sind deshalb eigene Textebenen.

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
auf genau ein Projekt: Gantt, Board, Sprints, Berichte und Ressourcen, aber keine Risiken und keine Arbeitsjournale.

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

## Scrum-Zusagen und Velocity

Der Scrum Guide 2020 kennt drei Zusagen: Product Goal, Sprint Goal und Definition of Done. Das Sprint Goal steht am `Sprint`, die anderen beiden am `Project` (`productGoal`, `definitionOfDone` als JSON-Liste). GitLab kennt beides nicht, deshalb nur in der Taktline-DB.

- **DoD beim Abschliessen:** Zieht jemand eine Story auf dem Board nach Done, fragt ein Dialog die DoD und die Akzeptanzkriterien ab. Offene Punkte warnen, sperren aber nicht. Ob etwas fertig ist, entscheidet das Team, nicht das Werkzeug.
- **Velocity:** erledigte Story Points pro abgeschlossenem Sprint, eingefroren beim Abschluss (`completedPoints`). Der Durchschnitt der letzten drei Sprints ist der Richtwert; plant ein offener Sprint mehr als 20 % darüber, zeigt die Sprints-Seite eine Warnung.
- `lib/agile/velocity.ts` ist frei von Server-Abhängigkeiten, weil die Browser-Komponente es importiert; das Laden steckt in `lib/agile/commitments.ts`.

## Tasks unter Stories

Native GitLab-Tasks (Work Item Type „Task“) statt eigener Datenhaltung, damit sie auch in GitLab unter der Story stehen. Getestet gegen GitLab CE 19.5:

- **REST** kennt Tasks als Issues mit `issue_type=task`: anlegen, verschieben, schliessen und `time_estimate` gehen wie bei Issues. Die Issue-Liste liefert sie mit, deshalb markiert der Sync sie (`isTask`) und setzt sie auf `isUnscheduled`. Damit fallen sie automatisch aus Gantt, Berichten, Ressourcen und CSV.
- **Die Zuordnung zur Story** gibt es nur über GraphQL (`lib/gitlab/tasks.ts`). Der Sync holt alle Task-Eltern in einem Abruf, der Webhook fragt für einen einzelnen Task nach. Gespeichert wird sie als `storyId`, bewusst getrennt von `parentId` (Gantt-Hierarchie).
- **Board:** Story-Karten zeigen den Task-Fortschritt und klappen die Tasks auf (abhaken direkt auf der Karte); das Taskboard hat eine Zeile pro Story mit Anlegen in der Zeile; „Meine Tasks“ filtert auf die angemeldete Person. Beim Verschieben nach Done nennt die DoD-Abfrage offene Tasks.
- **Suche:** Tasks verlinken auf `board?task=<id>`; das Board klappt die Story auf, setzt den Sprint-Filter auf „Alle“ und hebt den Task hervor. Alte `gantt?wp=`-Links auf Tasks leiten dorthin um.
- **Sprint-Burndown** aus den Abschlusszeitpunkten (`closedAt`) von Tasks (Stunden oder Anzahl) oder Stories (SP). Ohne tägliche Schnappschüsse; der Umfang ist deshalb der heutige, spätere Neuschätzungen verschieben die ganze Kurve. SP fallen erst, wenn eine Story fertig ist, und die Velocity bleibt bewusst so (keine anteiligen Punkte). Den Fortschritt innerhalb des Sprints zeigen die Tasks: als Einheit im Burndown, als Zähler im Sprint-Kopf und als Hinweis „Alle Tasks erledigt“ auf Stories, die nur noch auf Review oder DoD-Prüfung warten (`storyCloseHint` in `lib/agile/tasks.ts`).

## Sprint Review und Retrospektive

Pro Sprint eine Seite (`/projects/:id/sprints/:number`). Review: `Sprint.goalOutcome` (`yes`/`partly`/`no`) und `reviewNotes`, dazu das Inkrement aus den Board-Daten. Retro: `SprintRetroItem` in drei Spalten, Punkte-Abstimmung über `SprintRetroVote` (höchstens drei pro Person und Sprint, serverseitig geprüft).

- **Massnahmen schliessen den Kreis:** Eine Massnahme wird auf Klick ein GitLab-Issue mit Label `retro`, eingeplant im nächsten offenen Sprint (`issueIid` am Item). Die Retro des Folgesprints zeigt, ob das Issue geschlossen ist.
- **Nur für angemeldete Personen.** Lese-Links zeigen die Retro nicht: Sie ist ein geschützter Raum des Teams.
- Die Seite lädt sich alle 5 s neu, damit das Team gleichzeitig Karten schreiben kann.

## Kanban-Fluss: WIP-Limits und Cumulative Flow

- **WIP-Limits** stehen als JSON am Projekt (`wipLimits`, nur To Do, In Arbeit, Review). Das Board zählt die sichtbaren Karten, färbt eine überfüllte Spalte und warnt beim Hineinziehen, sperrt aber nicht.
- **Cumulative Flow** braucht den Verlauf der Spalten. GitLab liefert Label-Wechsel nicht abfragbar, deshalb hält Taktline pro Projekt und Tag einen Stand fest (`BoardSnapshot`): nach jedem Verschieben, nach Webhooks, im Reconciliation-Job und beim Öffnen des Boards. Der letzte Stand des Tages gilt. Das Diagramm beginnt deshalb mit dem Tag der Einführung.
- Farben: eine Farbe in Helligkeitsstufen (ordinal), weil die Spalten eine Reihenfolge haben; mit dem Palette-Validator geprüft.

## Planning Poker

Schätzrunden pro User Story (`EstimationRound`, `EstimationVote`), Deck modifiziertes Fibonacci (`lib/agile/poker.ts`). Das Team spielt **asynchron**: Gelegte Karten bleiben gespeichert, bis jemand aufdeckt. Aufdecken, neu schätzen und übernehmen darf jede angemeldete Person, eine Moderatorrolle gibt es nicht.

- **Kein Spicken:** `GET /api/projects/:id/poker` liefert fremde Kartenwerte erst nach dem Aufdecken, vorher nur „hat gelegt“.
- **Polling statt Push:** Die Seite fragt alle 2 s nach. Die Route merkt sich dabei im Speicher, wer gerade zuschaut (Anwesenheit, 10 s gültig, geht bei einem Neustart verloren).
- **Ergebnis:** Übernehmen schreibt `story_points` in den gantt-meta-Block (ganze Zahlen laut AGENTS.md, deshalb wird ½ als Vorschlag zu 1) und hält es an der Runde fest. Alte Runden bleiben als Verlauf.
- **Gleichzeitigkeit:** Aufdecken ist ein bedingtes Update (`revealedAt IS NULL`), neue Runden sind über `(workPackageId, number)` eindeutig. Zwei gleichzeitige Klicks ergeben denselben Zustand.

## Agenten-API

Für Daten, die nur in der Taktline-DB liegen, gibt es Routen unter `/api/agent/*`: `sprints`, `journal`, `project` (Product Goal, DoD, WIP-Limits, Velocity, Meilensteine), `risks`, `retro`, `poker`, `gantt` und `reports` (`view=report|flow|audit`). Retro, Poker und Berichte sind nur lesbar: Retro-Karten und Schätzungen sind Sache des Teams. Der Agent schickt seinen GitLab-Token als Bearer-Token; `lib/agent/access.ts` prüft damit Konto, Projekt und Rolle in GitLab (Lesen ab Reporter, Schreiben ab Developer) und speichert ihn nicht. Eigene Taktline-Tokens gibt es bewusst nicht.

Die Regeln stehen jeweils einmal und gelten für Web-App und Agenten gleich: `lib/agile/sprint-ops.ts`, `lib/agile/frame-ops.ts` (Product Goal, DoD, WIP) und `lib/risks/ops.ts`. Risikoänderungen von Agenten tragen im Risiko-Verlauf `RiskHistory.agent` statt einer `userId`. Der Unterschied ist nur der `Actor`: in der Web-App die angemeldete Person mit ihrem OAuth-Token, bei Agenten das Agent-Konto mit seinem eigenen Token. Im Audit-Log steht beim Agenten dessen GitLab-Username (`after.agent`).

## Arbeitsjournal

Pro Person und Projekt ein Eintrag je Arbeitstag (`JournalEntry`). GitLab kennt dafür kein Feld, die Daten liegen also nur in der Taktline-DB. Alle Angemeldeten lesen, schreiben dürfen Personen nur ihre eigenen Einträge; das prüfen die Server Actions. Lese-Links zeigen Journale nicht.

Agenten lesen über `GET /api/agent/journal?project=<pfad|id>`. Die Route bekommt den GitLab-Token des Agenten als Bearer-Token, prüft damit die Mitgliedschaft (mindestens Reporter) und speichert ihn nicht. Es gibt also keine eigene Token-Verwaltung.

Mit `POST` auf dieselbe Route legen Agenten **AI-Vorschläge** an (mindestens Developer). Ein Vorschlag ist ein normaler `JournalEntry` mit gesetztem `suggestedBy` (Username des Agent-Kontos) für eine Person, die Projektmitglied ist und sich schon einmal angemeldet hat. Sichtbar ist er nur für diese Person und zählt nicht zu ihren Stunden. Speichert sie ihn im Dialog, wird `suggestedBy` geleert und der Eintrag gehört ihr. Ein neuer Vorschlag ersetzt nur einen Vorschlag; einen bestätigten Eintrag überschreibt ein Agent nie (`409`).
