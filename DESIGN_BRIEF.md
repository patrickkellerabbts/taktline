# Design Brief — Gantt-Chart Webapp

> Internes Projektmanagement-Tool, das die Lücke zwischen GitLab CE und einer vollwertigen PM-Software (MS Project, Jira o.ä.) füllt. Liest GitLab-Issues und -Milestones, ergänzt sie um Planungsdaten (Start-Dates, Dependencies, Resource-Allocation, Hierarchie), und visualisiert alles als Gantt-Chart.

---

## 1. Kontext

- **Wo läuft das**: Self-hosted intern bei einem ~20-Personen-Team auf der gleichen Maschine wie das interne GitLab CE.
- **Wer nutzt es**:
  - **Projektleiter**: plant Termine, vergibt Aufgaben, behält Überblick. Tägliche Nutzung.
  - **Teammitglieder (Entwickler)**: sehen ihre Aufgaben, ändern Progress, kommentieren weiter in GitLab.
  - **Stakeholder** (zukünftig): Read-only View.
- **Sprache**: Deutsch. Alles. Buttons, Labels, Fehlermeldungen.
- **Plattform**: Desktop-Browser, letzte 2 Major-Versionen von Chrome, Firefox, Edge, Safari. Kein Mobile.
- **Datenmenge**: V1 bis ~50 Projekte, je ~100 Work Packages, ~20 Meilensteine. Realistisch 95 WPs gleichzeitig im Gantt sichtbar.

## 2. Technische Constraints fürs Design

- **Stack**: Next.js 16 (App Router), React 19, **Tailwind CSS v4** (CSS-first config via `@theme`), TypeScript.
- **Komponenten-Bibliothek**: bewusst KEINE — nur Tailwind. Komponenten werden selbst gebaut.
- **Dark Mode**: vorhanden, soll mitgedacht werden.
- **Icons**: aktuell keine Library installiert (Lucide oder Tabler wären plausibel — Designer darf empfehlen).
- **Custom Gantt-Chart**: eigene SVG-Implementierung, keine fertige Bibliothek. UI vom Designer komplett gestaltbar.

## 3. Screens — was gibt's, was soll besser werden

### 3.1 Login (`/login`)
- Eine zentrierte Karte mit Titel "Anmelden", kurzem Hilfetext, und einem orangen "Mit GitLab anmelden" Button.
- Wird durchschnittlich 1× pro Woche gesehen — Session hält 7 Tage.
- **Status**: funktional, sehr schlicht. Karten-Design steht.

### 3.2 Projekt-Liste (`/projects`)
- Header oben mit App-Titel "Gantt-Chart", Navigation, User-Handle, Logout-Button.
- Heading "Projekte", rechts ein "Projekt aktivieren" Button.
- Grid aus Projekt-Karten (3 Spalten desktop). Pro Karte: Projektname, GitLab-ID, Counts (z.B. "95 Work Packages · 8 Meilensteine"), Link "Gantt öffnen →" in Orange.
- Leerer Zustand: gestrichelter Border mit Hinweistext.
- **Status**: funktional. Karten sind sehr minimalistisch. Verbesserungspotential: Hierarchie, Aktivitäts-Status, letzte Sync-Zeit.

### 3.3 Projekt aktivieren (`/projects/activate`)
- Liste aller GitLab-Projekte, in denen der User Maintainer+-Rechte hat.
- Pro Eintrag: Projektname, Pfad mit Namespace, Beschreibung (truncated), rechts "Aktivieren" Button.
- Bereits aktivierte Projekte zeigen "Gantt öffnen →" statt Aktivieren-Button.
- **Status**: funktional, Listendarstellung.

### 3.4 Gantt-Ansicht (`/projects/[id]/gantt`) — **Hauptbildschirm**
Das hier ist der Bildschirm, auf dem der PM 80% seiner Zeit verbringt.

**Aktuelle Layout-Struktur (kann komplett umgestaltet werden):**
- Heading mit Projektname + Counts, rechts "Neu synchronisieren" Button.
- Großer Container mit:
  - **Toolbar** oben: Zoom-Stufen (Tag/Woche/Monat/Quartal), rechts "Heute"-Button.
  - **Zwei-Spalten-Layout**:
    - Links (280px fest): Liste der Work Package Titel ("#42 Login-Flow refactoren"). Meilensteine zuerst als "Meilensteine"-Sammelzeile.
    - Rechts: SVG-Timeline mit Datums-Header oben (2-Reihen-Achse), horizontal scrollbar.
  - **In der Timeline**:
    - Wochenende-Hintergrund (leicht abgesetzt, nur bei Tag-Zoom)
    - Heute-Linie als rote vertikale Linie
    - Meilensteine als orange Diamanten in der ersten Zeile
    - Work-Package-Bars: Höhe 20px, gerundet, Farbe nach Status (blau=offen, grün=geschlossen, dunkelgrau=Summary)
    - Progress-Füllung als dunklerer Overlay innerhalb der Bar
- Darunter: einklappbare Debug-Tabelle ("Tabellen-Ansicht (Debug)" — kann später weg).

**Was noch fehlt** (Designer darf in Mockups einplanen):
- **Hierarchie / Tree-View** in der linken Spalte: Expand/Collapse-Carets, Einrückung pro Tiefe, Summary-Bars spannen über Kinder.
- **Dependency-Pfeile** zwischen Bars (4 Typen: FS, SS, FF, SF) — als kleine geschwungene SVG-Pfeile.
- **Drag & Drop**: Bar horizontal verschieben → ändert Termine. Rand ziehen → ändert Dauer.
- **Side-Panel** rechts beim Klick auf eine Bar: Editieren von Start, Ende, Progress, Beschreibung, Assignees, Dependencies.
- **Resource-View / Auslastung**: alternative Sicht "wer macht was wann", mit Überallokation-Warnung.
- **Suche / Filter**: nach Status, Assignee, Label, Meilenstein.
- **Critical-Path-Highlight** (nice-to-have, V2).

### 3.5 Header / Navigation (alle authentifizierten Seiten)
- 56px hohe Top-Bar, weiß / zinc-900 im Dark Mode.
- Links: App-Titel als Link zur Projekt-Liste.
- Rechts: "Projekte", User-Handle "@username", "Abmelden".
- **Status**: funktional, sehr schlicht. Profile-Avatar wäre nett.

---

## 4. Aktueller Design-Stand

**Farbpalette (Tailwind-Defaults):**
- Hintergrund Light: `bg-zinc-50`, Karten `bg-white`
- Hintergrund Dark: `bg-zinc-950`, Karten `bg-zinc-900`
- Borders: `zinc-200` / `zinc-800`
- Text: `zinc-900` / `zinc-100`
- Sekundärtext: `zinc-600` / `zinc-400`
- Accent: Orange (`orange-600` für Login-Button und Gantt-öffnen-Links — angelehnt an GitLab-Branding)
- Status:
  - Issue offen / "in progress": Blau (`blue-600`, im Gantt `#2563eb`)
  - Issue geschlossen: Grün (`green-600`, im Gantt `#16a34a`)
  - Summary-Task: Dunkelgrau (`zinc-800`)
  - Meilenstein: Bernstein (`amber-700`, im Gantt `#a16207`)
  - Heute-Linie: Rot (`red-600`)

**Typografie:**
- Geist Sans (Variable Font, eingebunden via `next/font/google`)
- Geist Mono für tabular numbers
- Standard-Größen: Headings `text-2xl font-semibold`, Body `text-sm`, Caption `text-xs`

**Komponenten-Style:**
- Karten: `rounded-lg border border-zinc-200`, dezenter Shadow
- Buttons primär: gefüllt, mittlere Roundness
- Buttons sekundär: Border, dezent
- Hover: subtile Hintergrund-Aufhellung
- Fokus: 2px Orange-Ring

## 5. Was ich vom Design erhoffe

1. **Ein zusammenhängendes visuelles System** — aktuell ist's reine Funktion + Tailwind-Defaults, kein Charakter.
2. **Gantt-Optimierung**: bei 95 Tasks mit Hierarchie braucht der Bildschirm visuell mehr Hilfe (Gruppierung, Farbcodes für Milestones, klare Status-Affordanzen).
3. **Mehr Dichte ohne Crowd**: PMs wollen viel sehen, aber nicht alles gleichzeitig schreien.
4. **Branding-Identität** — die App heißt aktuell schlicht "Gantt-Chart", könnte einen Codenamen + Logo bekommen.
5. **Dark Mode** als gleichwertiger erster Bürger, nicht als Afterthought.

Out of Scope für V1:
- Mobile / Tablet-Layouts
- Animationen / Transitions (außer dezenten Hover)
- Onboarding-Flows / Empty-State-Illustrationen (können später kommen)
- Marketing-Pages

## 6. Was Designer als Output liefern soll(te)

- **Mockups** für die 4 Screens (Login, Projects, Activate, Gantt) jeweils in Light und Dark Mode
- **Style-Tokens** als CSS-Custom-Properties oder Tailwind v4 `@theme`-Block (Farben, Spacings, Radii, Schriftgrößen)
- **Komponenten-Inventar**: Buttons, Karten, Tabellen, Toolbar, Side-Panel-Struktur
- **Gantt-Komponente** im Detail: Bar-Stile, Hover-States, Selection-State, Dependency-Pfeil-Styling
- **Empfehlung für Icon-Library** (Lucide / Tabler / Phosphor)
- **(Optional)** Logo / Wordmark

---

## 7. Daten-Beispiel zur Orientierung

Repräsentatives Projekt:
- 95 Work Packages, 8 Meilensteine, 0 Dependencies (initial — wachsen wenn User Editor benutzt)
- Issues über 2 Jahre verteilt (`created_at` als Start-Date, da GitLab-CE kein nativer Start-Date kennt)
- Statusverteilung typisch: ~60 offen, ~35 geschlossen
- Labels variieren: bug, feature, technical-debt, doku — Designer könnte Label-Chip-System mitdesignen

## 8. Repository-Referenzen

Wenn Designer Code-Kontext braucht:
- Gantt-Component: `src/components/gantt/GanttView.tsx` (alles in einer Datei, SVG-basiert)
- Layout-Wrapper: `src/components/layout/AppHeader.tsx`
- Globale CSS / Theme: `src/app/globals.css` + Tailwind v4 `@theme`-Block
- UI-Strings: `src/lib/i18n/de.ts` (zentralisiert, kein i18next)
- Page-Routen: `src/app/login/`, `src/app/projects/`, `src/app/projects/[id]/gantt/`

Genauere funktionale Specs für V1 stehen in `REQUIREMENTS.md` (User Stories, Funktionale Anforderungen, Datenmodell).
