# Gantt-Chart Webapp — Requirements V1

> Internes Projektmanagement-Tool als Bridge zwischen GitLab CE und einer vollwertigen PM-Software. Visualisiert Work Packages und Meilensteine als Gantt-Chart, ergänzt GitLab um Planungs-Features die in CE fehlen (Start-Dates, Dependencies, Resource-Auslastung), und synchronisiert bidirektional mit eurem GitLab.

---

## 1. Ziele & Non-Goals

### 1.1 Ziele V1

- **Visualisierung**: Work Packages und Meilensteine eines GitLab-Projekts als interaktives Gantt-Chart darstellen.
- **Planung**: Start-/Enddaten, Dependencies und Progress pflegen — auch für Felder, die GitLab CE nativ nicht kennt.
- **GitLab-Integration**: GitLab bleibt Source of Truth für Issues und Milestones. Datenfluss bidirektional dort wo es Sinn ergibt.
- **Self-hosted**: Läuft on-prem neben der bestehenden GitLab-CE-Instanz, kein Cloud-Service.
- **Schlanker Start**: Funktioniert für <20 User und <50 Projekte ohne Skalierungs-Aufwand.

### 1.2 Explizit Non-Goals (V1)

- ❌ Kanban-Boards, Sprint-Planning, Time-Tracking, Budget-Management — GitLab und/oder Folge-Releases.
- ❌ Multi-Tenant / SaaS-Modell — wir haben eine Instanz pro Firma.
- ❌ Eigene User-Verwaltung — Authentifizierung läuft komplett über GitLab SSO.
- ❌ Mobile App — Web-only, Desktop-first.
- ❌ Reporting / BI / Export nach Excel — V2.
- ❌ Externe Stakeholder ohne GitLab-Account — V2 (Architektur lässt es offen).
- ❌ Offline-Modus.

---

## 2. Personas

| Persona | Rolle | Was sie tun |
|---|---|---|
| **Projektleiter (PM)** | Plant Projekte, vergibt Termine, behält Übersicht | Erstellt/editiert Work Packages und Meilensteine, setzt Dependencies, weist Personen zu |
| **Teammitglied (Dev)** | Arbeitet an Tasks | Sieht eigene Aufgaben im Gantt, ändert Progress, kommentiert in GitLab |
| **Stakeholder (lesend)** | Möchte Status sehen | Read-only View auf Projekte (V1: nur wenn er GitLab-Account hat) |

---

## 3. User Stories

### 3.1 Auth & Projekt-Auswahl
- **US-01** *Als User möchte ich mich mit meinem GitLab-Account einloggen, damit ich keine zusätzlichen Credentials brauche.*
- **US-02** *Als User möchte ich eine Liste der GitLab-Projekte sehen, auf die ich Zugriff habe, und eines auswählen können.*
- **US-03** *Als PM möchte ich ein GitLab-Projekt in unserer App "aktivieren" (Webhook registrieren, initial sync), damit es im Gantt verfügbar ist.*

### 3.2 Gantt-Visualisierung
- **US-04** *Als User möchte ich alle Work Packages des Projekts als horizontale Balken auf einer Zeitachse sehen.*
- **US-05** *Als User möchte ich Meilensteine als Diamanten/Marker auf der Zeitachse sehen.*
- **US-06** *Als User möchte ich zwischen Tages-/Wochen-/Monats-Zoom umschalten können.*
- **US-07** *Als User möchte ich den heutigen Tag als vertikale Linie sehen.*
- **US-08** *Als User möchte ich Work Packages nach Status (offen/in Arbeit/erledigt) farblich unterscheiden können.*

### 3.3 Work Package Management
- **US-09** *Als PM möchte ich für jedes Work Package ein Start- und Enddatum setzen können.*
- **US-10** *Als PM möchte ich einen Progress-Wert (0–100%) pflegen können, der im Balken visualisiert wird.*
- **US-11** *Als PM möchte ich ein Work Package direkt durch Klick auf den Balken bearbeiten können (Inline-Edit / Side-Panel).*
- **US-12** *Als PM möchte ich neue Work Packages in unserer App anlegen können — das erzeugt automatisch ein GitLab Issue.*
- **US-12a** *Als PM möchte ich Work Packages hierarchisch verschachteln können (Parent/Child), damit ich grobgranulare Pakete in feinere Aufgaben gliedern kann.*
- **US-12b** *Als PM möchte ich, dass Parent-Tasks im Gantt als "Summary Bar" über den Zeitraum ihrer Kinder dargestellt werden — Daten werden aus den Kindern berechnet, nicht manuell gepflegt.*

### 3.4 Drag & Drop
- **US-13** *Als PM möchte ich Balken horizontal verschieben können, um Termine zu ändern.*
- **US-14** *Als PM möchte ich an den Balken-Enden ziehen können, um Dauer zu ändern.*
- **US-15** *Als PM erwarte ich, dass abhängige Tasks automatisch mitwandern, wenn ich einen Vorgänger verschiebe (optional bestätigen).*

### 3.5 Dependencies
- **US-16** *Als PM möchte ich Verbindungen zwischen Tasks zeichnen können (Pfeile), um Vorgänger/Nachfolger zu definieren.*
- **US-17** *Als PM möchte ich vier Dependency-Typen unterstützen: Finish-to-Start (Standard), Start-to-Start, Finish-to-Finish, Start-to-Finish.*
- **US-18** *Als PM möchte ich zirkuläre Dependencies blockiert bekommen mit klarer Fehlermeldung.*

### 3.6 Ressourcen
- **US-19** *Als PM möchte ich GitLab-User einem Work Package zuweisen (mehrere möglich).*
- **US-20** *Als PM möchte ich pro Zuweisung einen Auslastungsanteil (z.B. 50%) angeben können.*
- **US-21** *Als PM möchte ich eine "Auslastung pro Person"-Sicht haben, die Überallokation hervorhebt.*

### 3.7 Meilensteine
- **US-22** *Als PM möchte ich Meilensteine aus GitLab im Gantt sehen.*
- **US-23** *Als PM möchte ich Meilensteine in unserer App erstellen/editieren können — wird in GitLab gespiegelt.*

### 3.8 Sync
- **US-24** *Als User erwarte ich, dass Änderungen aus GitLab (Issue closed, Title geändert) innerhalb weniger Sekunden im Gantt sichtbar sind.*
- **US-25** *Als User erwarte ich, dass Änderungen aus unserer App in GitLab erscheinen (z.B. neuer Due Date am Issue).*

---

## 4. Funktionale Anforderungen

### 4.1 Authentifizierung & Autorisierung
- **FR-A1** Login ausschließlich via OAuth2 gegen die interne GitLab-CE-Instanz.
- **FR-A2** Nach erfolgreichem Login wird der User-Datensatz lokal angelegt (id, gitlab_user_id, email, name, avatar_url) bzw. aktualisiert.
- **FR-A3** Access- und Refresh-Token werden **verschlüsselt** in der DB persistiert (AES-GCM mit Key aus Umgebungsvariable).
- **FR-A4** API-Calls an GitLab erfolgen im Namen des aktuell eingeloggten Users → automatische Berechtigungs-Respektierung.
- **FR-A5** Session-Cookies: `httpOnly`, `secure`, `sameSite=lax`. Session-Dauer: konfigurierbar, Default 7 Tage mit Sliding-Renewal.

### 4.2 Projekt-Aktivierung
- **FR-P1** Beim ersten Zugriff auf ein GitLab-Projekt prüft die App, ob es schon "aktiviert" ist.
- **FR-P2** Falls nicht: PM mit `maintainer`+ -Rolle kann das Projekt aktivieren. Dabei:
  - Webhook wird via GitLab API für `issues_events`, `confidential_issues_events` und beliebige Events für Milestones registriert.
  - Initialer Sync zieht alle offenen Issues und Milestones.
- **FR-P3** Webhook-Secret pro Projekt generiert, in unserer DB gespeichert, in den Webhook eingetragen. Alle eingehenden Webhook-Calls werden verifiziert: GitLab sendet den Secret im Klartext im `X-Gitlab-Token`-Header (kein HMAC), wir vergleichen via `crypto.timingSafeEqual` gegen das gespeicherte Secret.

### 4.3 Gantt-View
- **FR-G1** Default-View: aktuelles Quartal, Wochen-Granularität, heute zentriert.
- **FR-G2** Zoom-Stufen: Tag, Woche, Monat, Quartal.
- **FR-G3** Wochenenden sind farblich abgesetzt (Hintergrund).
- **FR-G4** Heute-Linie als rote vertikale Linie.
- **FR-G5** Linke Spalte: Baumansicht (Tree) der Work Packages mit Expand/Collapse — Issue-ID, Titel, Assignees, Status. Default-Gruppierung: nach Meilenstein, innerhalb dessen hierarchisch nach Parent/Child.
- **FR-G6** Balkenfarbe nach State: `opened` blau, `in progress` (Label-basiert) orange, `closed` grün; überfällig rot.
- **FR-G7** Progress-Visualisierung: Fortschrittsfüllung innerhalb des Balkens.
- **FR-G8** **Summary Bars** für Parent-Tasks: span vom frühesten Start eines Kindes bis zum spätesten Ende. Progress = gewichteter Durchschnitt der Kinder (gewichtet nach Dauer). Optisch anders als Leaf-Tasks (z.B. schwarzer Balken mit Endmarkern).
- **FR-G9** Parent-Tasks sind **nicht** direkt mit Drag&Drop verschiebbar — sie folgen ihren Kindern. Editieren von Start/End nur an Leaf-Tasks erlaubt.
- **FR-G10** Parent-Issues in GitLab erhalten automatisch das Label `gantt::summary`, damit sie auch in GitLab-Listen als Sammel-Issue erkennbar sind. Label wird beim ersten Anlegen eines Kind-WPs gesetzt, beim Entfernen des letzten Kindes wieder entfernt.

### 4.4 Editing
- **FR-E1** Drag & Drop:
  - Balken horizontal verschieben → ändert `start_date` und `end_date` (Dauer bleibt gleich).
  - Linker Rand ziehen → ändert nur `start_date`.
  - Rechter Rand ziehen → ändert nur `end_date`.
  - Bei aktiviertem "Cascade"-Modus werden Nachfolger entlang Dependencies mitgeschoben (mit Bestätigungsdialog).
- **FR-E2** Klick auf Balken öffnet Side-Panel mit allen editierbaren Feldern.
- **FR-E3** Neue Work Packages: "+"-Button erstellt GitLab Issue mit Titel-Prompt, default Start = heute, End = heute+7d.
- **FR-E4** Dependencies: Im Edit-Modus per Klick-Drag zwischen zwei Balken eine Verbindung zeichnen. Typ via Kontext-Menü wählbar.

### 4.5 Resource-Allokation
- **FR-R1** Pro Work Package n Assignees mit jeweils `allocation_percent` (1–100).
- **FR-R2** Default bei neuer Zuweisung: 100%.
- **FR-R3** Resource-View: pro User horizontaler "Lane" mit allen Work Packages, Überlappung optisch summiert; >100% rot.

### 4.6 Sync-Verhalten
- **FR-S1** **GitLab → App** (Webhook-getrieben):
  - Issue created → neues WorkPackage anlegen (mit `start_date`=heute, `end_date`=Issue.due_date oder +7d).
  - Issue updated → Felder aktualisieren (Titel, State, Description, Assignees, due_date → `end_date`).
  - Issue closed → State updaten, NICHT löschen.
  - Issue deleted → WorkPackage soft-delete (`deleted_at`).
  - Milestone events analog.
- **FR-S2** **App → GitLab** (sofort via Server Action):
  - `end_date` geändert → `PUT /projects/:id/issues/:iid` mit neuem `due_date`.
  - Title/Description geändert → analog.
  - Assignees geändert → analog.
  - `start_date`, `progress_percent`, `dependencies`, `allocation_percent` → NICHT nach GitLab (kein Feld vorhanden). Werden nur lokal gespeichert.
- **FR-S3** Konfliktauflösung: bei `end_date`-Konflikt (User hat in GitLab und App fast zeitgleich editiert) gewinnt die neuere Änderung (`updated_at`-Vergleich). Klar erkennbarer Konflikt → kleiner Toast-Hinweis.
- **FR-S4** Fallback-Polling: alle 15 Min Reconciliation-Sync, der prüft, ob Webhooks etwas verpasst haben (Sicherheitsnetz). _Status: noch nicht implementiert._

#### Test-Status der Sync-Pfade

- **App → GitLab (FR-S2)**: ausgiebig manuell getestet (Inspector-Edits, Drag&Drop, Neue Aufgabe).
- **GitLab → App via Webhook (FR-S1)**: Handler in `src/app/api/gitlab/webhook/route.ts` ist implementiert, aber **noch nicht im Dev getestet** weil GitLab CE die Webhook-Registrierung gegen `http://localhost:*` ablehnt. Testen sobald die App auf einem internen Server deployed ist, den GitLab erreichen kann.
- **Initial- und Re-Sync** über die "Synchronisieren"-Action: getestet, inkl. Orphan-Cleanup für gelöschte Issues.

### 4.7 Audit & Logging
- **FR-L1** Jede schreibende Aktion erzeugt einen Audit-Log-Eintrag (`user_id`, `action`, `entity`, `entity_id`, `before`, `after`, `timestamp`).
- **FR-L2** Webhook-Empfänge werden geloggt (success/failure, signature_valid, payload-hash).
- **FR-L3** Strukturierte Logs (JSON) auf stdout, Container-Standard.

---

## 5. Nicht-funktionale Anforderungen

| Bereich | Anforderung |
|---|---|
| **Performance** | Gantt mit 200 Tasks rendert <300ms. API-Latenz P95 <500ms gegen GitLab CE. |
| **Browser-Support** | Letzte 2 Major-Versionen von Chrome, Firefox, Edge, Safari. |
| **Sprache** | UI auf Deutsch. Englisch als Fallback / spätere Option. |
| **Accessibility** | Keyboard-Navigation für Side-Panel und Listenansicht. Voller A11y-Audit ist Non-Goal V1, aber keine bewussten Verstöße. |
| **Security** | OWASP Top 10 Awareness; Webhook-Signaturen; Token-Encryption; CSP-Header; Rate-Limiting auf Webhook-Endpoint. |
| **Verfügbarkeit** | Best Effort, kein SLA. Single-Instance-Deployment. |
| **Backups** | Postgres `pg_dump` nightly via Cron auf externes Volume (Doku, kein App-Feature). |
| **Datenschutz** | Keine personenbezogenen Daten von Externen. User-Daten sind die ohnehin in GitLab vorhandenen. |

---

## 6. Datenmodell (Logisch)

```
users
├─ id (UUID, PK)
├─ gitlab_user_id (INT, UNIQUE)
├─ username
├─ email
├─ name
├─ avatar_url
├─ access_token_encrypted
├─ refresh_token_encrypted
├─ token_expires_at
├─ created_at, updated_at

projects                            // aktivierte GitLab-Projekte
├─ id (UUID, PK)
├─ gitlab_project_id (INT, UNIQUE)
├─ name_cache
├─ webhook_id (INT)                 // GitLab-Webhook-ID
├─ webhook_secret_encrypted
├─ activated_by_user_id (FK)
├─ created_at, last_full_sync_at

work_packages
├─ id (UUID, PK)
├─ project_id (FK)
├─ gitlab_issue_iid (INT)
├─ parent_id (FK → work_packages, nullable)   // hierarchische Verschachtelung
├─ start_date (DATE, NOT NULL)      // unser Feld; bei Parents berechnet aus Kindern
├─ end_date (DATE, NOT NULL)        // gespiegelt aus GitLab due_date; bei Parents berechnet
├─ progress_percent (INT 0-100)     // unser Feld; bei Parents berechnet (gewichteter Durchschnitt)
├─ is_summary (BOOLEAN, default false) // true wenn das Work Package Kinder hat
├─ title_cache, description_cache, state_cache, labels_cache (JSONB)
├─ last_synced_at, deleted_at
├─ UNIQUE(project_id, gitlab_issue_iid)
├─ INDEX(parent_id)

milestones
├─ id (UUID, PK)
├─ project_id (FK)
├─ gitlab_milestone_id (INT)
├─ title_cache, due_date_cache, state_cache
├─ last_synced_at

dependencies
├─ id (UUID, PK)
├─ predecessor_id (FK → work_packages)
├─ successor_id (FK → work_packages)
├─ type (ENUM: FS, SS, FF, SF)
├─ lag_days (INT, default 0)
├─ created_at, created_by_user_id

resource_allocations
├─ id (UUID, PK)
├─ work_package_id (FK)
├─ user_gitlab_id (INT)             // referenziert GitLab-User, nicht zwingend in users-Tabelle
├─ allocation_percent (INT 1-100)

audit_log
├─ id (UUID, PK)
├─ user_id (FK, nullable für System)
├─ action (TEXT)
├─ entity_type, entity_id
├─ before (JSONB), after (JSONB)
├─ created_at
```

---

## 7. GitLab-Integration Details

### 7.1 OAuth-Application Setup (einmalig im GitLab)
- Applikations-Typ: confidential, Redirect URI: `https://<unsere-app>/api/auth/callback/gitlab`
- Scopes: `read_user`, `api` (notwendig zum Schreiben).
- Client-ID + Secret in Env-Variablen.

### 7.2 Verwendete GitLab-Endpoints
| Operation | Endpoint |
|---|---|
| Projektliste | `GET /projects?membership=true` |
| Projekt-Details | `GET /projects/:id` |
| Issues listen | `GET /projects/:id/issues?state=opened&per_page=100` |
| Issue updaten | `PUT /projects/:id/issues/:iid` |
| Issue erstellen | `POST /projects/:id/issues` |
| Milestones | `GET/POST/PUT /projects/:id/milestones[/:id]` |
| Webhook anlegen | `POST /projects/:id/hooks` |
| Member listen | `GET /projects/:id/members/all` |

### 7.3 Webhook-Events
- `issue` events (open, close, reopen, update)
- `confidential_issue` events
- alle Milestone-Änderungen werden NICHT via Webhook ausgeliefert (GitLab-Limitation); Lösung: Milestone-Reconciliation als Teil des 15-min-Polls.

### 7.4 Konflikt-Regeln (zusammengefasst)
| Feld | Bei Konflikt gewinnt |
|---|---|
| title, description, state, assignees, labels | GitLab |
| due_date (= unser end_date) | Neuere `updated_at` |
| start_date, progress, dependencies, allocations, parent_id | Wir (GitLab hat es nicht) |

### 7.5 Custom Metadaten via HTML-Comment in Issue Description

Damit Planungs-Felder, die GitLab CE nicht kennt, auch für User sichtbar sind, die Issues direkt in GitLab anschauen, schreiben wir einen versionierten YAML-Block am **Ende** der Issue Description.

**Format:**

```markdown
... regulärer Description-Inhalt ...

<!-- gantt-meta:v1
start_date: 2026-06-01
parent_iid: 42
progress: 30
dependencies:
  - iid: 41
    type: FS
    lag_days: 0
allocations:
  - gitlab_user_id: 5
    percent: 50
  - gitlab_user_id: 12
    percent: 100
-->
```

**Schreib-Regeln:**
- **Lokation**: Immer am Ende der Description, mit einer Leerzeile davor.
- **Versioning**: `v1` im Marker — bei Schema-Änderungen erhöhen, alter Reader bleibt rückwärtskompatibel.
- **Idempotenz**: Beim Schreiben wird ein evtl. vorhandener `<!-- gantt-meta:vX ... -->`-Block zuerst per Regex aus der Description entfernt, dann neu angehängt. Restliche Description bleibt unangetastet.
- **Atomarität**: Nur schreiben wenn sich Werte tatsächlich geändert haben (verhindert API-Spam und Webhook-Echos).
- **Leere Felder weglassen** — nicht `null` schreiben.

**Lese-Regeln:**
- Beim Sync GitLab → App: Description parsen, `gantt-meta:vN`-Block extrahieren, in lokale DB übernehmen.
- Bei Konflikt zwischen DB und Description-Block: **DB gewinnt**, Description wird beim nächsten Push korrigiert. (Wir sind der "Master" für diese Felder; die Description ist nur eine Spiegelung für Sichtbarkeit.)
- Wenn `gantt-meta` mehrfach in der Description vorkommt: nur den letzten Block lesen, Rest verwerfen beim nächsten Schreiben.

**Webhook-Echo verhindern:**
Wenn unsere App via `PUT /issues/:iid` die Description aktualisiert, löst das einen `issue update`-Webhook aus. Lösung: vor jedem App→GitLab-Push merken wir uns `(issue_iid, new_updated_at)` in einer kleinen In-Memory-LRU; eintreffende Webhooks mit passendem Schlüssel werden ignoriert.

### 7.6 GitLab-Version: Kompatibilität mit 15.11.13

| Feature | Status in 15.11 CE |
|---|---|
| OAuth2 Application | ✅ |
| REST API v4 (Issues, Milestones, Webhooks) | ✅ |
| Issue `due_date` Feld | ✅ |
| Webhook `issue` Events (open/close/update/reopen) | ✅ |
| Webhook `milestone` Events | ❌ — Workaround: Reconciliation-Poll alle 15 Min (siehe FR-S4) |
| Sub-Issues / Hierarchie nativ | ❌ — EE-Feature; wir halten Hierarchie in unserer DB + HTML-Comment |
| Issue Links (`relates_to`, `blocks`) | ✅ — optional zusätzlich nutzbar für maschinenlesbare Dependency-Hints in GitLab |
| Scoped Labels | ❌ — EE; wir nutzen normale Labels |
| GraphQL API | ✅ — aber Schema in 15.11 unterscheidet sich von 16+; wir bleiben in V1 bei REST. |

---

## 8. API / Server Actions Übersicht (intern)

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/projects` | Liste aktivierter Projekte |
| POST | `/api/projects/activate` | GitLab-Projekt aktivieren (Webhook + Initial Sync) |
| GET | `/api/projects/:id/gantt` | Aggregierte Gantt-Daten (WPs, Milestones, Dependencies, Allocations) |
| PATCH | `/api/work-packages/:id` | Update (lokale Felder + Push nach GitLab wenn nötig) |
| POST | `/api/work-packages` | Anlegen (erzeugt auch GitLab Issue) |
| POST | `/api/dependencies` | Dependency hinzufügen (mit Zykluscheck) |
| DELETE | `/api/dependencies/:id` | Entfernen |
| POST | `/api/allocations` | Allokation setzen |
| POST | `/api/gitlab/webhook` | Webhook-Receiver (signaturverifiziert) |

(Server Actions wo es passt; explizite API-Routen für Webhook und ggf. Mobile-Future.)

---

## 9. Tech-Stack-Festlegung

| Schicht | Wahl | Begründung |
|---|---|---|
| Framework | Next.js 16 (App Router) + TypeScript | Per `create-next-app@latest` installiert (16.2.6) — neuer als ursprünglich angenommenes 15 |
| Datenbank | PostgreSQL 16 | Beste Wahl für relationale Daten + JSONB-Cache |
| ORM | Prisma | Reife Toolchain, gute DX, vom Team bevorzugt |
| Auth | Auth.js (NextAuth v5) mit GitLab Provider | Standard, gut integriert |
| GitLab Client | `@gitbeaker/rest` | TypeScript-typisiert, aktiv gepflegt |
| Gantt-Lib | `wx-react-gantt` (SVAR, **GPLv3**) | Hierarchie, Summary Bars, Dependencies (4 Typen), D&D. Kommerzielle Lizenz für non-OSS-Use verfügbar; für unser internes Tool ist GPLv3 akzeptabel. |
| Job-Queue | `pg-boss` (Postgres-basiert, keine extra Infra) | Reicht für unsere Größe; kein Redis nötig |
| Deployment | Docker Compose | Konsistent mit GitLab-CE-Setup |
| Logging | Pino → stdout → Docker | Standard |

---

## 10. Offene Punkte / Decisions To Make

1. **Gantt-Bibliothek** — Spike mit `wx-react-gantt` und ggf. `frappe-gantt`. Evaluierung gegen FR-E1 bis FR-E4 + FR-R3 + Summary Bars (FR-G8). Hierarchie-Support ist hartes Kriterium.
2. ~~**Lokalisierung**~~ ✅ **Entschieden:** Hart Deutsch in V1. Alle UI-Strings zentralisiert in `messages/de.json` (oder `lib/i18n/de.ts`), damit `next-intl` / `i18next` später ohne Refactoring nachrüstbar ist.
3. ~~**Hierarchie / Sub-Tasks**~~ ✅ **Entschieden:** Verschachtelt. DB-getrieben (`parent_id`), Spiegelung in GitLab via HTML-Comment (`parent_iid`) und Label `gantt::summary` an Parent-Issues.
4. ~~**Custom Fields in GitLab Issue Description**~~ ✅ **Entschieden:** Ja, YAML-Block in HTML-Comment (siehe 7.5).
5. ~~**Welche GitLab CE Version**~~ ✅ **Entschieden/Geprüft:** 15.11.13 (siehe 7.6 für Feature-Kompatibilität).

---

## 11. Roadmap nach V1 (Ausblick, nicht V1)

- V1.1: Read-Only Stakeholder-Accounts (lokale Auth nachrüsten)
- V1.2: Excel/CSV-Export, PDF-Snapshot
- V1.3: Resource-Heatmap über Projekte hinweg
- V2: Sub-Task-Hierarchie, kritischer Pfad-Highlight
- V2: Mehrere GitLab-Instanzen
