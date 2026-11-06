# `gantt-meta` Format-Spezifikation

Taktline ergänzt GitLab-Issues um Planungsfelder, die GitLab CE nativ nicht
kennt (Start-Datum, Hierarchie, Dependencies, Progress, Resource-Allocation).
Diese werden als **versionierter YAML-Block in einem HTML-Kommentar** an die
Issue-Description angehängt.

Diese Datei beschreibt das Format, damit externe Tools (z.B. `glab` CLI,
Skripte, oder KI-Agenten via GitLab-API) Issues direkt bearbeiten können
ohne den Block kaputt zu machen. Die Webapp ist dafür nicht nötig — wer
sich an dieses Format hält, kann GitLab-Issues und unsere Gantt-Sicht
konsistent halten.

## Format

Am **Ende** der Issue-Description, getrennt durch eine Leerzeile:

```
<reguläre Issue-Description-Text in Markdown — beliebig lang>

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

## Feld-Referenz

| Feld | Typ | Pflicht | Bedeutung |
|---|---|---|---|
| `start_date` | ISO-Date `YYYY-MM-DD` | optional | Start-Datum des Work Packages. GitLab kennt nur `due_date` (= Ende), dies ist die fehlende Hälfte. |
| `baseline_start` | ISO-Date `YYYY-MM-DD` | optional | Eingefrorener Plan-Start (Baseline für Plan-vs-Ist-Vergleich). Nur wirksam in Kombination mit `baseline_end`. |
| `baseline_end` | ISO-Date `YYYY-MM-DD` | optional | Eingefrorenes Plan-Ende. Nur wirksam in Kombination mit `baseline_start`. |
| `parent_iid` | Integer | optional | Issue-IID (project-scoped, nicht globale ID) des übergeordneten Work Packages. Erzeugt Hierarchie. |
| `progress` | Integer 0–100 | optional | Fortschritt in Prozent. |
| `story_points` | Integer ≥ 0 | optional | Schätzung einer User Story. GitLab CE kennt keine Issue-Weights, deshalb steht der Wert hier. |
| `dependencies` | Array | optional | Liste der Vorgänger. Diese Issue wird abhängig von den genannten. |
| `dependencies[].iid` | Integer | wenn `dependencies` gesetzt | IID des Vorgänger-Issues im selben Projekt. |
| `dependencies[].type` | `FS` \| `SS` \| `FF` \| `SF` | wenn `dependencies` gesetzt | Dependency-Typ. Default `FS` (Finish-to-Start) wenn weggelassen. |
| `dependencies[].lag_days` | Integer | optional | Verzögerung in Tagen zwischen Vorgänger und Nachfolger. Default `0`. |
| `allocations` | Array | optional | Resource-Allocation pro Person. |
| `allocations[].gitlab_user_id` | Integer | wenn `allocations` gesetzt | GitLab-User-ID der zugewiesenen Person (nicht username). |
| `allocations[].percent` | Integer 1–100 | wenn `allocations` gesetzt | Auslastung in Prozent. |

**Felder die NICHT in den Block gehören** (gehören in GitLab-native Felder):

- `title` → GitLab Issue-Titel
- `description` → Rest der Description (vor dem Block)
- `due_date` → GitLab `due_date`-Feld (das ist unser `end_date`)
- `state` → GitLab Issue-State (close/reopen via API)
- `assignee_ids` → GitLab `assignee_ids`-Feld
- `labels` → GitLab `labels`-Feld

## Board und User Stories

Das Kanban-Board liest ausschliesslich GitLab-native Felder. Wer Issues per API bearbeitet, kann es direkt mitsteuern:

| Spalte | Abbildung in GitLab |
|---|---|
| Offen | offen, kein `board::`-Label |
| To Do | offen, Label `board::todo` |
| In Arbeit | offen, Label `board::doing` |
| Review | offen, Label `board::review` |
| Done | Issue geschlossen |

- **Nur ein Spalten-Label pro Issue.** GitLab CE setzt das nicht durch. Bei mehreren gewinnt die am weitesten fortgeschrittene Spalte; die nächste Verschiebung auf dem Board entfernt die übrigen.
- **Sprint** = Label `sprint::<nummer>`, höchstens eines pro Issue (bei mehreren gewinnt die höchste Nummer). Name, Ziel und Daten liegen nur in der Taktline-DB; ein Label ohne passenden Sprint wird ignoriert.
- **User Story** = Label `type::story`. Ohne `start_date` und ohne `due_date` erscheint sie nur auf dem Board, nicht im Gantt.
- **Story-Text** steht als Markdown vor dem Block. Dieses Muster erkennt der Dialog, alles andere zeigt er als Notizen:

```
**Als** Redakteurin **möchte ich** Beiträge terminieren, **damit** sie pünktlich erscheinen.

### Akzeptanzkriterien

- [ ] Termin wählbar
- [x] Vorschau vorhanden
```

## Tasks unter User Stories

Tasks sind **native GitLab-Tasks** (Work Item Type „Task“, REST `issue_type=task`), nicht Teil des `gantt-meta`-Blocks:

- **Zuordnung** zur Story über die GitLab-Hierarchie (GraphQL `workItemUpdate` mit `hierarchyWidget.parentId`). `parent_iid` im Block ist dafür **nicht** gedacht; das ist die Gantt-Hierarchie und machte die Story zum Summary-Task.
- **Schätzung** in der GitLab-Zeiterfassung (`POST /projects/:id/issues/:iid/time_estimate?duration=3h`).
- **Spalte** wie bei jeder Karte über `board::`-Labels, Done = geschlossen.
- Taktline zeigt Tasks nur im Taskboard und im Sprint-Burndown, nie im Gantt.

## Regeln beim Schreiben

1. **Genau ein Block pro Issue.** Wenn schon einer existiert: entferne den alten zuerst, schreibe dann den neuen.
2. **Block am Ende** der Description. Mit einer Leerzeile zwischen sonstigem Inhalt und dem Marker `<!-- gantt-meta:v1`.
3. **Versionsmarker** `v1` immer mitschreiben. Bei Schema-Änderung in Zukunft wird die Version hochgezählt; alte Reader bleiben rückwärtskompatibel.
4. **Leere Felder weglassen.** Schreibe nicht `start_date:` ohne Wert, sondern lass die Zeile weg.
5. **Idempotent.** Mehrfaches Anwenden derselben Änderung muss zum gleichen Ergebnis führen.
6. **Restliche Description nicht anrühren.** Nur den `<!-- gantt-meta:v1 ... -->` Block ersetzen, alles davor bleibt unverändert.

## Algorithmus zum Updaten

```
1. Lies die aktuelle Issue-Description aus GitLab.
2. Entferne jeglichen vorhandenen `<!-- gantt-meta:vX ... -->` Block
   (Regex: /<!--\s*gantt-meta:v\d+\s*[\s\S]*?-->/g).
3. Trimme trailing whitespace.
4. Hänge eine Leerzeile + den neuen Block an.
5. Schreibe die neue Description via PUT /projects/:id/issues/:iid.
```

## Beispiele

### Issue ohne gantt-meta — erstes Setzen

Ausgangs-Description:

```
Refactor des Login-Flows. Soll OAuth2 PKCE unterstützen.
```

Nach Setzen von `start_date: 2026-06-01` und `progress: 0`:

```
Refactor des Login-Flows. Soll OAuth2 PKCE unterstützen.

<!-- gantt-meta:v1
start_date: 2026-06-01
progress: 0
-->
```

### Issue mit existierendem Block — Update

Vorher:

```
Beschreibung blabla …

<!-- gantt-meta:v1
start_date: 2026-06-01
progress: 0
-->
```

Setze Progress auf 50, ergänze einen Vorgänger #38 FS:

```
Beschreibung blabla …

<!-- gantt-meta:v1
start_date: 2026-06-01
progress: 50
dependencies:
  - iid: 38
    type: FS
    lag_days: 0
-->
```

### Issue mit allen Feldern

```
Datenbank-Migration durchführen. Migration-Script in `migrations/` ablegen.

Mehrere Absätze Description …

<!-- gantt-meta:v1
start_date: 2026-07-01
parent_iid: 42
progress: 30
dependencies:
  - iid: 41
    type: FS
    lag_days: 2
  - iid: 40
    type: SS
    lag_days: 0
allocations:
  - gitlab_user_id: 5
    percent: 50
-->
```

## Tools

Ersetze `<group>/<project>` und `<host>` mit deiner GitLab-Instanz.

### Mit der Taktline-CLI (empfohlen)

`scripts/taktline-cli.ts` nutzt den Reference-Parser und hält die Regeln oben automatisch ein. `npm run skill:install` installiert sie zusammen mit dem Skill aus [`skills/taktline`](skills/taktline/SKILL.md) global für Claude Code, danach geht sie aus jedem Repo:

```bash
node ~/.claude/skills/taktline/taktline.mjs current
node ~/.claude/skills/taktline/taktline.mjs move 42 doing --dry-run
```

Zugangsdaten stehen in `~/.config/taktline/agent.env` (`GITLAB_URL`, `GITLAB_TOKEN`, für das Arbeitsjournal auch `TAKTLINE_URL`). Das Zielprojekt kommt aus `GITLAB_PROJECT`, sonst aus `.taktline-project` im Repo (anlegen mit `link`), sonst aus einem Git-Remote auf dieser GitLab-Instanz. Ohne eindeutiges Projekt bricht die CLI ab.

### Mit `glab` CLI

```bash
# Description lesen
glab issue view 42 -P <group>/<project> --output json | jq -r '.description'

# Description aktualisieren (nachdem du den neuen Block in new-description.md gebaut hast)
glab issue update 42 -P <group>/<project> --description "$(cat new-description.md)"
```

### Mit `curl` direkt gegen die API

```bash
# Lesen
curl -s -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://<host>/api/v4/projects/<id>/issues/42" \
  | jq -r '.description'

# Schreiben
curl -X PUT -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg desc "$(cat new-description.md)" '{description: $desc}')" \
  "https://<host>/api/v4/projects/<id>/issues/42"
```

## Konflikt-Verhalten

Wenn ein Agent ein Issue ändert während es in der Taktline-Webapp gerade bearbeitet wird:

- Webapp's Self-Push wird via Echo-Schutz erkannt (10-Sekunden-Fenster, im Webhook-Receiver) und nicht erneut prozessiert.
- Bei externer Änderung (via Agent oder GitLab-UI) liest die Webapp die neuen Daten beim nächsten Sync oder Webhook.
- **Field-Level-Regel:** GitLab gewinnt bei Konflikt. Wenn du also einen Wert im `gantt-meta`-Block änderst, hat das Vorrang vor dem, was die Webapp gerade in der DB hat (beim nächsten Sync wird's überschrieben).

## Reference-Implementierung

Die kanonische Parser-/Serializer-Implementierung ist in
[`src/lib/gitlab/meta.ts`](src/lib/gitlab/meta.ts):

- `parseGanttMeta(description)` → `GanttMeta | null`
- `serializeGanttMeta(description, meta)` → neue Description mit aktualisiertem Block
- `stripGanttMeta(description)` → Description ohne irgendeinen Block
- Zod-Schema `GanttMetaSchema` definiert die exakte Typ-Erwartung
