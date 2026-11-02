# Taktline — Roadmap

Sammlung möglicher Features und Verbesserungen. Lebendes Dokument — Priorität
und Scope können sich ändern.

---

## Als nächstes geplant (Top-2)

### 1. MR/Pipeline-Status im Inspector

Tieferer GitLab-Anschluss: für jeden WP zeigen wir verlinkte Merge Requests
und ihren Status (open/merged/closed) plus den letzten Pipeline-Status.
Klick → Sprung in GitLab.

**Scope:**
- Beim Sync: für jedes Issue verlinkte MRs via `/issues/:iid/related_merge_requests` laden
- Cache in WorkPackage (oder eigene Tabelle `WorkPackageMR`)
- Inspector zeigt MR-Liste mit Status-Badges + letztem Pipeline-Result
- Pipeline-Status via `/projects/:id/merge_requests/:iid/pipelines` oder
  Project-Pipeline-Endpoint (last commit on MR-branch)

**Geschätzter Aufwand:** mittel — Sync-Erweiterung + neue UI-Section

### 2. Comments im Inspector

GitLab-Issue-Kommentare lesen und schreiben direkt aus dem WP-Inspector.
Spart das Hin-und-Her-Springen in GitLab für kurze Rückfragen.

**Scope:**
- Sync: Notes via `/issues/:iid/notes` laden (System-Notes ausfiltern, nur
  echte Comments)
- Cache in eigener Tabelle `WorkPackageNote` (id, body, author, createdAt)
- Inspector-Section "Kommentare" mit Liste + Eingabefeld
- Schreiben via `POST /issues/:iid/notes`
- Webhook reagiert auf `Note Hook` Events für Live-Updates

**Geschätzter Aufwand:** mittel-gross — neues Datenmodell + Editor + Webhook

---

## Workflow / täglicher Gebrauch

- **Bulk-Edit für mehrere WPs** — Multi-Select via Lasso oder Shift-Click,
  z.B. 10 Tasks gleichzeitig um eine Woche verschieben
- **Undo/Redo** für Datums-/Progress-Änderungen — non-trivial wegen
  GitLab-Round-Trip, evtl. nur als Toast "Rückgängig?" sofort nach Änderung
- **Keyboard-Shortcuts** dokumentieren + erweitern (j/k zwischen Tasks,
  e = edit, d = duplicate, ⌘Z = undo)
- **Vorlagen / Templates** für wiederkehrende WP-Strukturen (z.B.
  "Standard-Sprint-Block")

## Visualisierung & PM-Konzepte

- **Burn-Down/Burn-Up-Charts** in Reports — Open-Tasks-Verlauf über Zeit
- **S-Kurven (Earned Value Management)** — Plan-Wert/Ist-Wert/Kosten-Wert
  als kumulierte Kurven
- **Calendar-View** als alternative Ansicht (Wochen-/Monatsraster)
- **Agile Methoden, nächste Schritte** — Kanban-Board, User Stories und Sprints
  sind umgesetzt; offen sind Sprint-Burndown, Velocity pro Sprint, Priorisierung
  im Backlog, WIP-Limits und konfigurierbare Spalten
- **Heatmap-Overlay** auf der Timeline — Aktivitäts-Dichte pro Tag

## Rechte

- **Rechte-Management** — Heute kennt Taktline keine eigenen Rollen: wer sich per
  GitLab anmelden kann, sieht alle aktivierten Projekte und kann deren Risiken
  ändern. Lese-Links sind die einzige feinere Stufe. Offen: Zugriff pro Projekt
  an die GitLab-Mitgliedschaft binden, Rollen für Risiken

## Tiefere GitLab-Integration

- **MR-Status & Pipeline-Status** pro WP (siehe Top-2)
- **Comments lesen + schreiben** (siehe Top-2)
- **Time-Tracking** via GitLabs `/spend` und `/estimate` Slash-Commands
  visualisieren (geplant vs. tatsächlich)
- **Epic-Support** (GitLab Premium) als zusätzliche Hierarchie-Ebene über
  Issues
- **Issue-Activity-Feed** als eigene Page pro Projekt

## Operations / Robustheit

- **Virtualisierung der Task-Liste** — wird ab ~500 WPs spürbar (windowing
  via z.B. `@tanstack/react-virtual`)
- **Server-side Filtering/Pagination** für sehr grosse Projekte
- **Excel-Export (.xlsx)** zusätzlich zu CSV — Excel ist für Stakeholder
  bequemer, CSV ist eher Devs
- **Mobile-Layout** — derzeit blockiert ab <900px. Read-only Mobile-View
  für Unterwegs-Checks wäre wertvoll
- **PWA-Support** mit Service Worker — Installation als App auf iPad/iPhone

## Collaboration

- **Activity-Feed pro Projekt** — strukturiert, suchbar (Bell-Menu zeigt
  nur unread)
- **Email-Digest** wöchentlich an Assignees: "deine nächsten 3 fälligen
  Tasks", "X überfällig"
- **@-Mentions** in Comments mit Notification an User
- **Slack/Teams-Integration** für Notifications (Webhook nach extern)

## Reporting / Export

- **Custom Report Builder** — KPIs definierbar, gespeicherte Reports
- **Scheduled Reports** per Email (täglich/wöchentlich/monatlich)
- **DSGVO-konformer Export** (alle Daten eines Users als ZIP)
- **PDF-Export für Reports** (nicht nur Gantt, auch Dashboard-Snapshots)

## Project Management Best Practices

- **Risk-Register / RAID-Log** — Risks, Assumptions, Issues, Dependencies
  als strukturierte Liste pro Projekt
- **Stakeholder-Mapping** — wer ist informiert, beteiligt, entscheidet
- **Approval-Workflows** — z.B. Milestone als "abgenommen" markieren mit
  Sign-Off durch Stakeholder

## Admin / Operations

- **Multi-Tenant** — mehrere GitLab-Instanzen parallel
- **Projekt-Archivierung** — abgeschlossene Projekte aus dem aktiven Set
  rausnehmen ohne sie zu löschen
- **Backup/Restore** der `gantt-meta:v1` Blocks (für Migration zwischen
  GitLab-Instanzen)

## Mobile / Responsive

- **Mobile-Layout** für Smartphones/Tablets (Read-only initial)
- **Touch-Gesten** auf der Timeline optimieren (Long-Press für Inspector,
  Drag mit zwei Fingern für Verschieben)

## Integrations

- **Calendar-Sync** (Google/Outlook) — fällige Tasks als Termine
- **Slack/Teams-Notifications** für relevante Events
- **Webhook-System** für externe Tools (z.B. wenn Milestone closed → POST)
- **Jira/Asana-Importer** für Migration von anderen Tools

---

## Bereits implementiert (nicht mehr offen)

- Baseline-Vergleich (Plan-vs-Ist): gantt-meta-Felder + Schraffur-Bar +
  Ribbon-Toggle + Inspector-Section + Bulk-Freeze/Clear mit Progress
- Gantt mit Hierarchie, Dependencies (FS/SS/FF/SF) + Lag-Days
- Critical Path Method (CPM) Berechnung + Visualisierung
- Konflikt-Erkennung mit Popover-Navigation
- WP-CRUD + Inspector mit Picker für Parent/Dependencies
- Milestones CRUD mit Cluster-Picker
- Resource-View (per Projekt + globale Übersicht)
- Reports-Dashboard mit Donut, Stats, Konflikten
- ⌘K-Suche über WPs + Milestones
- Reconciliation-Poll via `instrumentation.ts`
- GitLab-Webhook-Receiver mit Echo-Schutz
- `gantt-meta:v1` YAML-Format für Extension-Felder
- PDF-Export A3 mit separater Print-View (Auto-Fit auf eine Seite)
- User-Settings inkl. Erweitert-Section
- Pinch-Zoom via Trackpad (Inertia, Anchor am Cursor)
- AppHeader-Nav springt zu zuletzt geöffnetem Projekt
- Breadcrumbs in der Subbar als Links
- Drag-Bars im Gantt (Start/End verschieben + resizen)
- Label-Editor mit Möglichkeit neue Labels anzulegen
- About-Page mit Build-Info, Tech-Stack, Lizenz
- AuditLog für State-Transitions (Velocity-Chart)
- Bell-Menu mit Notifications
- Status-Bar mit Popovers (Offen/Fertig/Meilensteine/Konflikte)
