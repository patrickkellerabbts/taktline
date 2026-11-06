/**
 * Seed für die Demo-Daten.
 *
 * Legt ein vollständig erfundenes Beispiel-Projekt an ("Website-Relaunch 2026")
 * inklusive Hierarchie, Dependencies, Meilensteinen, Auslastung und Risiken —
 * genug Substanz, damit Gantt, Ressourcen-Heatmap, Berichte und Risikomatrix
 * etwas zu zeigen haben. Alle Namen, Titel und Daten sind frei erfunden.
 *
 * Zwei Aufrufer teilen sich diese Logik:
 *  - `npm run demo:seed` (scripts/seed-demo.ts) für die lokale Demo-DB
 *  - der Auto-Reset des Demo-Servers (siehe src/instrumentation.ts)
 *
 * Deshalb liegt der Code hier in src/ statt in scripts/: das Standalone-Image
 * enthält weder tsx noch das scripts-Verzeichnis.
 *
 * Zusätzlich wird eine Session mit festem Token angelegt (DEMO_SESSION_TOKEN),
 * damit Demo-Login und Screenshot-Runner ohne GitLab-OAuth auskommen.
 */
import { STORY_LABEL } from '@/lib/agile/board';
import { buildStoryDescription } from '@/lib/agile/story';
import { serializeGanttMeta } from '@/lib/gitlab/meta';
import type { PrismaClient, DependencyType } from '@prisma/client';
import { DEMO_SESSION_TOKEN, DEMO_PROJECT_ID } from './constants';

// Fixes Bezugsdatum statt new Date(): so sehen wiederholte Läufe (und damit
// auch die Screenshots) immer gleich aus. "Heute" liegt bewusst mitten im
// Projekt, damit die Today-Linie im Gantt sichtbar ist.
const TODAY = new Date('2026-08-09T00:00:00Z');

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

// ─── Personen (frei erfunden) ────────────────────────────────────────

const PEOPLE = [
  { gitlabUserId: 101, username: 'a.berger', name: 'Anna Berger', email: 'a.berger@example.com' },
  { gitlabUserId: 102, username: 't.fischer', name: 'Tom Fischer', email: 't.fischer@example.com' },
  { gitlabUserId: 103, username: 'l.wagner', name: 'Lena Wagner', email: 'l.wagner@example.com' },
  { gitlabUserId: 104, username: 'm.huber', name: 'Max Huber', email: 'm.huber@example.com' },
  { gitlabUserId: 105, username: 's.kern', name: 'Sarah Kern', email: 's.kern@example.com' },
];

function assignee(gitlabUserId: number) {
  const p = PEOPLE.find((x) => x.gitlabUserId === gitlabUserId)!;
  return { id: p.gitlabUserId, username: p.username, name: p.name };
}

// ─── Labels ──────────────────────────────────────────────────────────

const LABELS = [
  { name: 'frontend', color: '#3b82f6' },
  { name: 'backend', color: '#8b5cf6' },
  { name: 'design', color: '#ec4899' },
  { name: 'infra', color: '#0ea5e9' },
  { name: 'content', color: '#f59e0b' },
  { name: 'qs', color: '#10b981' },
  { name: 'blockiert', color: '#ef4444' },
  { name: STORY_LABEL, color: '#e8590c' },
  { name: 'board::todo', color: '#76746c' },
  { name: 'board::doing', color: '#1f6feb' },
  { name: 'board::review', color: '#a16207' },
  { name: 'sprint::1', color: '#76746c' },
  { name: 'sprint::2', color: '#76746c' },
  { name: 'sprint::3', color: '#76746c' },
];

// ─── Work Packages ───────────────────────────────────────────────────
// `key` ist nur scriptintern (für Parent-/Dependency-Referenzen), in der DB
// steht die gitlabIssueIid.

type WpSeed = {
  key: string;
  iid: number;
  title: string;
  start: string;
  end: string;
  progress: number;
  state?: 'opened' | 'closed';
  parent?: string;
  summary?: boolean;
  labels?: string[];
  assignees?: number[];
  allocations?: { gitlabUserId: number; percent: number }[];
  baseline?: [string, string];
  milestone?: string;
  /** User Story: Text landet in der Description, Punkte im gantt-meta-Block. */
  story?: { role: string; goal: string; benefit: string; criteria: string[]; points?: number };
  /** Story ohne Datum: nur auf dem Board, start/end sind dann der Sync-Fallback. */
  unscheduled?: boolean;
};

const WPS: WpSeed[] = [
  // ── Phase 1: Analyse & Konzept ──
  { key: 'p1', iid: 1, title: 'Analyse & Konzept', start: '2026-06-01', end: '2026-06-26', progress: 100, state: 'closed', summary: true },
  { key: 'p1a', iid: 2, title: 'Ist-Analyse bestehende Website', start: '2026-06-01', end: '2026-06-09', progress: 100, state: 'closed', parent: 'p1', labels: ['content'], assignees: [101], allocations: [{ gitlabUserId: 101, percent: 60 }], milestone: 'm1' },
  { key: 'p1b', iid: 3, title: 'Stakeholder-Interviews führen', start: '2026-06-03', end: '2026-06-12', progress: 100, state: 'closed', parent: 'p1', assignees: [103], allocations: [{ gitlabUserId: 103, percent: 40 }], milestone: 'm1' },
  { key: 'p1c', iid: 4, title: 'Informationsarchitektur festlegen', start: '2026-06-15', end: '2026-06-19', progress: 100, state: 'closed', parent: 'p1', labels: ['design'], assignees: [103], allocations: [{ gitlabUserId: 103, percent: 80 }], milestone: 'm1' },
  { key: 'p1d', iid: 5, title: 'Anforderungskatalog abstimmen', start: '2026-06-22', end: '2026-06-26', progress: 100, state: 'closed', parent: 'p1', assignees: [101], allocations: [{ gitlabUserId: 101, percent: 50 }], milestone: 'm1' },

  // ── Phase 2: Design ──
  { key: 'p2', iid: 10, title: 'Design & Prototyping', start: '2026-06-29', end: '2026-08-07', progress: 85, summary: true },
  { key: 'p2a', iid: 11, title: 'Moodboard & Farbkonzept', start: '2026-06-29', end: '2026-07-07', progress: 100, state: 'closed', parent: 'p2', labels: ['design'], assignees: [103], allocations: [{ gitlabUserId: 103, percent: 100 }], milestone: 'm2' },
  { key: 'p2b', iid: 12, title: 'Wireframes Startseite + Unterseiten', start: '2026-07-08', end: '2026-07-20', progress: 100, state: 'closed', parent: 'p2', labels: ['design'], assignees: [103], allocations: [{ gitlabUserId: 103, percent: 80 }], milestone: 'm2' },
  { key: 'p2c', iid: 13, title: 'Design-System / Komponenten-Bibliothek', start: '2026-07-13', end: '2026-08-04', progress: 90, parent: 'p2', labels: ['design', 'frontend'], assignees: [103, 102], allocations: [{ gitlabUserId: 103, percent: 60 }, { gitlabUserId: 102, percent: 40 }], baseline: ['2026-07-13', '2026-07-29'], milestone: 'm2' },
  { key: 'p2d', iid: 14, title: 'Klickbarer Prototyp für Review', start: '2026-07-27', end: '2026-08-07', progress: 60, parent: 'p2', labels: ['design'], assignees: [103], allocations: [{ gitlabUserId: 103, percent: 50 }], milestone: 'm2' },

  // ── Phase 3: Implementierung ──
  { key: 'p3', iid: 20, title: 'Implementierung', start: '2026-07-20', end: '2026-10-16', progress: 35, summary: true },
  { key: 'p3a', iid: 21, title: 'Projekt-Setup + CI-Pipeline', start: '2026-07-20', end: '2026-07-29', progress: 100, state: 'closed', parent: 'p3', labels: ['infra'], assignees: [104], allocations: [{ gitlabUserId: 104, percent: 70 }] },
  { key: 'p3b', iid: 22, title: 'CMS-Anbindung + Content-Modell', start: '2026-07-30', end: '2026-08-21', progress: 65, parent: 'p3', labels: ['backend'], assignees: [102], allocations: [{ gitlabUserId: 102, percent: 80 }], milestone: 'm3' },
  { key: 'p3c', iid: 23, title: 'Startseite umsetzen', start: '2026-08-05', end: '2026-08-28', progress: 40, parent: 'p3', labels: ['frontend'], assignees: [102, 105], allocations: [{ gitlabUserId: 102, percent: 60 }, { gitlabUserId: 105, percent: 60 }], milestone: 'm3' },
  { key: 'p3d', iid: 24, title: 'Produktseiten + Filterlogik', start: '2026-08-24', end: '2026-09-18', progress: 10, parent: 'p3', labels: ['frontend', 'backend'], assignees: [105], allocations: [{ gitlabUserId: 105, percent: 100 }], milestone: 'm3' },
  { key: 'p3e', iid: 25, title: 'Suchfunktion mit Autocomplete', start: '2026-09-07', end: '2026-09-25', progress: 0, parent: 'p3', labels: ['backend'], assignees: [102], allocations: [{ gitlabUserId: 102, percent: 70 }] },
  { key: 'p3f', iid: 26, title: 'Kontaktformular + Spam-Schutz', start: '2026-09-14', end: '2026-09-25', progress: 0, parent: 'p3', labels: ['frontend'], assignees: [105], allocations: [{ gitlabUserId: 105, percent: 50 }] },
  { key: 'p3g', iid: 27, title: 'Redaktions-Workflow einrichten', start: '2026-09-21', end: '2026-10-09', progress: 0, parent: 'p3', labels: ['content'], assignees: [101], allocations: [{ gitlabUserId: 101, percent: 60 }] },
  { key: 'p3h', iid: 28, title: 'Mehrsprachigkeit (DE/FR/EN)', start: '2026-09-28', end: '2026-10-16', progress: 0, parent: 'p3', labels: ['backend', 'content'], assignees: [102, 101], allocations: [{ gitlabUserId: 102, percent: 50 }, { gitlabUserId: 101, percent: 50 }] },

  // ── Phase 4: Test & Rollout ──
  { key: 'p4', iid: 30, title: 'Test & Rollout', start: '2026-09-28', end: '2026-11-20', progress: 0, summary: true },
  { key: 'p4a', iid: 31, title: 'Barrierefreiheit prüfen (WCAG 2.2 AA)', start: '2026-09-28', end: '2026-10-14', progress: 0, parent: 'p4', labels: ['qs'], assignees: [104], allocations: [{ gitlabUserId: 104, percent: 60 }], milestone: 'm4' },
  { key: 'p4b', iid: 32, title: 'Performance-Budget verifizieren', start: '2026-10-05', end: '2026-10-16', progress: 0, parent: 'p4', labels: ['qs', 'infra'], assignees: [104], allocations: [{ gitlabUserId: 104, percent: 50 }], milestone: 'm4' },
  { key: 'p4c', iid: 33, title: 'Inhalte migrieren + redaktionell prüfen', start: '2026-10-12', end: '2026-11-06', progress: 0, parent: 'p4', labels: ['content'], assignees: [101, 103], allocations: [{ gitlabUserId: 101, percent: 80 }, { gitlabUserId: 103, percent: 40 }], milestone: 'm4' },
  { key: 'p4d', iid: 34, title: 'Redirect-Konzept alte URLs', start: '2026-10-19', end: '2026-10-30', progress: 0, parent: 'p4', labels: ['infra'], assignees: [104], allocations: [{ gitlabUserId: 104, percent: 40 }] },
  { key: 'p4e', iid: 35, title: 'Abnahme-Testlauf mit Fachbereich', start: '2026-11-02', end: '2026-11-13', progress: 0, parent: 'p4', labels: ['qs'], assignees: [105, 101], allocations: [{ gitlabUserId: 105, percent: 60 }, { gitlabUserId: 101, percent: 60 }], milestone: 'm5' },
  { key: 'p4f', iid: 36, title: 'Go-Live + Monitoring scharf schalten', start: '2026-11-16', end: '2026-11-20', progress: 0, parent: 'p4', labels: ['infra'], assignees: [104, 102], allocations: [{ gitlabUserId: 104, percent: 100 }, { gitlabUserId: 102, percent: 50 }], milestone: 'm5' },
];

// ─── User Stories ────────────────────────────────────────────────────

const STORIES: WpSeed[] = [
  { key: 's1', iid: 41, title: 'Produkte nach Einsatzgebiet filtern', start: '2026-10-26', end: '2026-11-09', progress: 0, unscheduled: true, labels: [STORY_LABEL, 'frontend'], story: { role: 'Besucherin', goal: 'Produkte nach Einsatzgebiet filtern', benefit: 'ich schneller das passende Angebot finde', criteria: ['Filter lässt sich mit der Tastatur bedienen', 'Auswahl bleibt beim Zurücknavigieren erhalten'], points: 5 } },
  { key: 's2', iid: 42, title: 'Newsletter im Footer abonnieren', start: '2026-10-26', end: '2026-11-09', progress: 0, unscheduled: true, labels: [STORY_LABEL, 'board::todo', 'frontend'], story: { role: 'Besucher', goal: 'mich im Footer für den Newsletter anmelden', benefit: 'ich über neue Produkte informiert bleibe', criteria: ['Double-Opt-in per E-Mail', 'Abmeldung jederzeit möglich'], points: 3 } },
  { key: 's3', iid: 43, title: 'Beiträge im Voraus terminieren', start: '2026-11-02', end: '2026-11-13', progress: 0, labels: [STORY_LABEL, 'board::doing', 'content'], assignees: [101], story: { role: 'Redakteurin', goal: 'Beiträge im Voraus terminieren', benefit: 'sie auch im Urlaub pünktlich erscheinen', criteria: ['Datum und Uhrzeit wählbar', 'Vorschau vor der Veröffentlichung'], points: 8 } },
  { key: 's5', iid: 45, title: 'Standorte auf einer Karte anzeigen', start: '2026-10-05', end: '2026-10-16', progress: 100, state: 'closed', labels: [STORY_LABEL, 'frontend'], assignees: [105], story: { role: 'Besucherin', goal: 'Standorte auf einer Karte sehen', benefit: 'ich den nächsten Standort schnell finde', criteria: ['Karte lädt ohne Cookies von Dritten'], points: 5 } },
  { key: 's6', iid: 46, title: 'Downloads nach Sprache filtern', start: '2026-10-26', end: '2026-11-09', progress: 0, unscheduled: true, labels: [STORY_LABEL, 'frontend'], story: { role: 'Besucher', goal: 'Downloads nach Sprache filtern', benefit: 'ich nur passende Dokumente sehe', criteria: ['Filter merkt sich die Auswahl'], points: 3 } },
  { key: 's7', iid: 47, title: 'Merkliste für Produkte', start: '2026-10-26', end: '2026-11-09', progress: 0, unscheduled: true, labels: [STORY_LABEL, 'frontend'], story: { role: 'Besucherin', goal: 'Produkte auf eine Merkliste setzen', benefit: 'ich sie später vergleichen kann', criteria: ['Merkliste bleibt ohne Login im Browser erhalten', 'Maximal 20 Produkte', 'Teilen per Link'] } },
  { key: 's8', iid: 48, title: 'Suche mit Tippfehler-Toleranz', start: '2026-10-26', end: '2026-11-09', progress: 0, unscheduled: true, labels: [STORY_LABEL, 'backend'], story: { role: 'Besucher', goal: 'auch mit Tippfehlern passende Produkte finden', benefit: 'ich nicht an der Schreibweise scheitere', criteria: ['„Fiter“ findet „Filter“', 'Antwort unter 300 ms'] } },
  { key: 's4', iid: 44, title: 'Kontaktanfragen im Backend einsehen', start: '2026-10-26', end: '2026-11-09', progress: 0, unscheduled: true, labels: [STORY_LABEL, 'board::review', 'backend'], assignees: [102], story: { role: 'Support-Mitarbeiter', goal: 'Kontaktanfragen im Backend einsehen', benefit: 'keine Anfrage verloren geht', criteria: ['Liste nach Eingangsdatum sortiert'], points: 2 } },
];

// Relativ zum Tag des Seeds, damit der aktive Sprint auch nach Monaten noch läuft.
const SPRINTS = [
  { number: 1, name: 'Sprint 1', goal: 'Grundgerüst der Startseite steht', state: 'closed', from: -19, to: -6 },
  { number: 2, name: 'Sprint 2', goal: 'Redaktion kann Inhalte selbst pflegen', state: 'active', from: -5, to: 8 },
  { number: 3, name: 'Sprint 3', goal: null, state: 'planned', from: 9, to: 22 },
] as const;

// Tasks unter den Stories des aktiven Sprints. `closed` = Tag des Schliessens
// relativ zum Seed, damit der Sprint-Burndown eine echte Kurve zeigt.
const TASKS: Array<{ story: string; iid: number; title: string; hours: number; assignee?: number; column?: 'doing' | 'review'; closed?: number }> = [
  { story: 's3', iid: 60, title: 'Datenmodell für Veröffentlichungstermine', hours: 3, assignee: 101, closed: -4 },
  { story: 's3', iid: 61, title: 'Datums- und Zeitwähler im Editor', hours: 5, assignee: 101, closed: -2 },
  { story: 's3', iid: 62, title: 'Cronjob veröffentlicht fällige Beiträge', hours: 6, assignee: 104, column: 'doing' },
  { story: 's3', iid: 63, title: 'Vorschau-Ansicht vor Veröffentlichung', hours: 4, assignee: 103 },
  { story: 's4', iid: 64, title: 'API-Endpunkt Kontaktanfragen', hours: 3, assignee: 102, closed: -3 },
  { story: 's4', iid: 65, title: 'Liste im Backend mit Sortierung', hours: 4, assignee: 102, column: 'review' },
  { story: 's2', iid: 66, title: 'Anmeldeformular im Footer', hours: 2, assignee: 105, closed: -1 },
  { story: 's2', iid: 67, title: 'Double-Opt-in-Mail versenden', hours: 4, assignee: 105 },
  { story: 's2', iid: 68, title: 'Abmeldelink und Bestätigungsseite', hours: 3 },
];

const SPRINT_OF: Record<string, number> = { s5: 1, p2a: 1, p2b: 1, s2: 2, s3: 2, s4: 2, p3b: 2, p3c: 2, s6: 3 };

// ─── Meilensteine ────────────────────────────────────────────────────

const MILESTONES = [
  { key: 'm1', iid: 1, title: 'Konzept freigegeben', due: '2026-06-26', state: 'closed' },
  { key: 'm2', iid: 2, title: 'Design abgenommen', due: '2026-08-07', state: 'active' },
  { key: 'm3', iid: 3, title: 'Feature-Complete', due: '2026-09-18', state: 'active' },
  { key: 'm4', iid: 4, title: 'QS abgeschlossen', due: '2026-11-06', state: 'active' },
  { key: 'm5', iid: 5, title: 'Go-Live', due: '2026-11-20', state: 'active' },
];

// ─── Dependencies ────────────────────────────────────────────────────
// Zwei davon sind bewusst nicht erfüllbar (p3h→p4c und p4c→p4e): der
// Nachfolger startet vor dem Ende des Vorgängers. Dadurch zeigt der Gantt
// die Konflikt-Markierung, statt dass das Feature auf den Bildern unsichtbar
// bleibt. Alle übrigen Verknüpfungen sind konsistent.

const DEPS: { from: string; to: string; type?: DependencyType; lag?: number }[] = [
  { from: 'p1a', to: 'p1c' },
  { from: 'p1b', to: 'p1c' },
  { from: 'p1c', to: 'p1d' },
  { from: 'p1d', to: 'p2a' },
  { from: 'p2a', to: 'p2b' },
  { from: 'p2b', to: 'p2c', type: 'SS', lag: 5 },
  { from: 'p2c', to: 'p2d', type: 'SS', lag: 10 },
  { from: 'p3a', to: 'p3b' },
  { from: 'p2c', to: 'p3c' },
  { from: 'p3b', to: 'p3d', type: 'SS', lag: 18 },
  { from: 'p3c', to: 'p3d', type: 'SS', lag: 19 },
  { from: 'p3d', to: 'p3e', type: 'SS', lag: 12 },
  { from: 'p3d', to: 'p3f', type: 'SS', lag: 15 },
  { from: 'p3e', to: 'p3g', type: 'SS', lag: 14 },
  { from: 'p3g', to: 'p3h', type: 'SS', lag: 5 },
  { from: 'p3d', to: 'p4a' },
  { from: 'p4a', to: 'p4b', type: 'SS', lag: 5 },
  { from: 'p3h', to: 'p4c', type: 'FS', lag: -3 },
  { from: 'p4b', to: 'p4d' },
  { from: 'p4c', to: 'p4e' },
  { from: 'p4e', to: 'p4f' },
];

// ─── Risiken ─────────────────────────────────────────────────────────

const RISKS = [
  { title: 'Inhalte werden nicht rechtzeitig geliefert', category: 'Organisation', pre: [4, 4], post: [2, 4], status: 'in_progress', owner: 101, wps: ['p4c'], ms: ['m4'], mitigation: 'Redaktionsplan mit verbindlichen Zwischenterminen; Platzhalter-Inhalte für den Testlauf akzeptieren.', contingency: 'Go-Live mit reduziertem Seitenumfang, Rest per Nachlieferung.' },
  { title: 'CMS-Migration verliert Metadaten', category: 'Technik', pre: [3, 5], post: [2, 3], status: 'mitigated', owner: 102, wps: ['p3b', 'p4c'], mitigation: 'Migrationsskript mit Dry-Run und Feldabgleich gegen Referenzexport.', contingency: 'Rollback auf Altsystem, Nachpflege der betroffenen Felder von Hand.' },
  { title: 'Performance-Budget auf Mobilgeräten verfehlt', category: 'Technik', pre: [3, 3], post: [2, 2], status: 'in_progress', owner: 104, wps: ['p4b'], mitigation: 'Bildpipeline mit AVIF, Lighthouse-Check als CI-Gate.' },
  { title: 'Schlüsselperson fällt in der Rollout-Phase aus', category: 'Ressourcen', pre: [2, 5], post: [2, 3], status: 'identified', owner: 101, wps: ['p4f'], ms: ['m5'], mitigation: 'Vier-Augen-Prinzip beim Deployment, Runbook dokumentieren.' },
  { title: 'Barrierefreiheits-Audit deckt Nacharbeit auf', category: 'Qualität', pre: [4, 3], post: [3, 2], status: 'in_progress', owner: 104, wps: ['p4a'], mitigation: 'Frühe Zwischenprüfung schon während der Komponentenentwicklung.' },
  { title: 'Rechtliche Freigabe der Datenschutzerklärung verzögert', category: 'Recht', pre: [3, 2], post: null, status: 'identified', owner: 103, ms: ['m5'] },
  { title: 'Alte URLs verlieren Suchmaschinen-Ranking', category: 'Marketing', pre: [3, 4], post: [1, 4], status: 'mitigated', owner: 104, wps: ['p4d'], mitigation: '301-Weiterleitungen für alle Bestands-URLs, Sitemap frühzeitig einreichen.' },
  { title: 'Mehrsprachigkeit sprengt den Zeitplan', category: 'Umfang', pre: [4, 3], post: [3, 3], status: 'identified', owner: 102, wps: ['p3h'], mitigation: 'FR/EN als Phase 2 nach Go-Live einplanen, DE zuerst vollständig.' },
  { title: 'Suchfunktion liefert unbrauchbare Treffer', category: 'Technik', pre: [2, 3], post: [1, 3], status: 'accepted', owner: 102, wps: ['p3e'] },
  { title: 'Abnahme durch Fachbereich verzögert sich', category: 'Organisation', pre: [3, 4], post: [2, 3], status: 'in_progress', owner: 101, wps: ['p4e'], ms: ['m5'], mitigation: 'Teilabnahmen pro Modul statt einer Gesamtabnahme am Ende.' },
  { title: 'Drittanbieter-Skripte brechen Cookie-Banner', category: 'Recht', pre: [2, 2], post: null, status: 'closed', owner: 105 },
];

export type SeedResult = {
  projectId: string;
  workPackages: number;
  milestones: number;
  dependencies: number;
  risks: number;
};

/**
 * Schreibt den kompletten Demo-Datensatz. BEWUSST DESTRUKTIV — leert vorher
 * alle Tabellen. Nur gegen eine dedizierte Demo-Datenbank aufrufen, niemals
 * gegen die Produktiv- oder Dev-DB.
 */
const JOURNAL: Array<{
  day: number;
  hours: number;
  title: string;
  technical: string | null;
  organizational: string | null;
  nextSteps: string | null;
  suggestedBy?: string;
}> = [
  {
    day: 0,
    hours: 2.5,
    title: 'Token-Refresh repariert',
    technical: 'Refresh-Token wird jetzt vor Ablauf erneuert, der Fehler beim zweiten Login ist behoben. Test für den Ablauf ergänzt.',
    organizational: null,
    nextSteps: 'Review durch das Team.',
    suggestedBy: 'taktline-agent',
  },
  {
    day: -1,
    hours: 3.5,
    title: 'Login-Flow fertiggestellt',
    technical: 'OAuth-Anmeldung umgesetzt und mit zwei Testkonten geprüft. Der Token-Refresh läuft noch nicht zuverlässig.',
    organizational: 'Mit dem Team die Abnahmekriterien für den Login abgestimmt.',
    nextSteps: 'Token-Refresh beheben.',
  },
  {
    day: -3,
    hours: 2,
    title: 'Datenmodell entworfen',
    technical: 'Erste Migration erstellt und das Modell für Beiträge und Rollen festgelegt.',
    organizational: null,
    nextSteps: null,
  },
];

export async function seedDemoData(prisma: PrismaClient): Promise<SeedResult> {
  // Alles Bestehende wegräumen. Die Demo-Session wird weiter unten mit
  // demselben Token neu angelegt — bereits geöffnete Browser-Tabs bleiben
  // dadurch über einen Reset hinweg eingeloggt.
  await prisma.riskHistory.deleteMany();
  await prisma.riskWorkPackage.deleteMany();
  await prisma.riskMilestone.deleteMany();
  await prisma.risk.deleteMany();
  await prisma.dependency.deleteMany();
  await prisma.resourceAllocation.deleteMany();
  await prisma.workPackageMr.deleteMany();
  await prisma.workPackage.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.projectLabel.deleteMany();
  await prisma.project.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();

  // Personen anlegen. Die erste ist gleichzeitig die eingeloggte Demo-Nutzerin.
  const users = new Map<number, string>();
  for (const p of PEOPLE) {
    const u = await prisma.user.create({
      data: {
        name: p.name,
        email: p.email,
        gitlabUserId: p.gitlabUserId,
        username: p.username,
        preferences: {},
      },
    });
    users.set(p.gitlabUserId, u.id);
  }
  const demoUserId = users.get(PEOPLE[0].gitlabUserId)!;

  // Session mit festem Token — der Screenshot-Runner setzt genau diesen Wert
  // als Cookie und ist damit ohne OAuth-Flow eingeloggt.
  await prisma.session.create({
    data: {
      sessionToken: DEMO_SESSION_TOKEN,
      userId: demoUserId,
      expires: new Date(TODAY.getTime() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  const project = await prisma.project.create({
    data: {
      id: DEMO_PROJECT_ID,
      gitlabProjectId: 4242,
      nameCache: 'beispiel/website-relaunch',
      activatedByUserId: demoUserId,
      lastFullSyncAt: new Date(TODAY.getTime() - 4 * 60 * 1000),
      productGoal:
        'Besucherinnen finden in höchstens drei Klicks das passende Produkt und den nächsten Standort, auch auf dem Handy.',
      definitionOfDone: [
        'Code von einer zweiten Person reviewt',
        'Automatische Tests grün',
        'Auf Staging von der Product Owner abgenommen',
        'Barrierefreiheit geprüft (Tastatur, Kontrast)',
      ],
      wipLimits: { doing: 3, review: 2 },
      labels: { create: LABELS.map((l) => ({ name: l.name, color: l.color, textColor: '#ffffff' })) },
    },
  });

  const msIds = new Map<string, string>();
  for (const m of MILESTONES) {
    const created = await prisma.milestone.create({
      data: {
        projectId: project.id,
        gitlabMilestoneId: m.iid,
        titleCache: m.title,
        dueDateCache: d(m.due),
        stateCache: m.state,
      },
    });
    msIds.set(m.key, created.id);
  }

  // Zwei Durchgänge: erst alle WPs anlegen, dann Parent-Verweise setzen —
  // sonst müsste die Reihenfolge in WPS der Hierarchie folgen.
  const wpIds = new Map<string, string>();
  for (const w of [...WPS, ...STORIES]) {
    // Pakete, an denen schon gearbeitet wird, gehören auf dem Board nach
    // "In Arbeit" statt in den Backlog.
    const labels = [
      ...(w.labels ?? []),
      ...(!w.story && !w.summary && w.state !== 'closed' && w.progress > 0 ? ['board::doing'] : []),
      ...(SPRINT_OF[w.key] ? [`sprint::${SPRINT_OF[w.key]}`] : []),
    ];
    const created = await prisma.workPackage.create({
      data: {
        projectId: project.id,
        gitlabIssueIid: w.iid,
        titleCache: w.title,
        stateCache: w.state ?? 'opened',
        startDate: d(w.start),
        endDate: d(w.end),
        // Geschlossene Pakete landen nicht exakt auf ihrem Plantermin — sonst
        // lägen Ist- und Plan-Linie im Burndown deckungsgleich übereinander
        // und die Demo zeigte eine Aussage, die kein Projekt je macht. Der
        // Versatz ist aus der IID abgeleitet, also über Resets hinweg stabil.
        closedAt: w.state === 'closed' ? addDays(d(w.end), (w.iid % 5) - 1) : null,
        progressPercent: w.progress,
        isSummary: w.summary ?? false,
        isUnscheduled: w.unscheduled ?? false,
        storyPoints: w.story?.points ?? null,
        descriptionCache: w.story
          ? serializeGanttMeta(
              buildStoryDescription({
                role: w.story.role,
                goal: w.story.goal,
                benefit: w.story.benefit,
                criteria: w.story.criteria.map((text) => ({ text, done: false })),
                notes: '',
              }),
              {
                ...(w.unscheduled ? {} : { start_date: w.start }),
                ...(w.story.points === undefined ? {} : { story_points: w.story.points }),
              },
            )
          : undefined,
        milestoneId: w.milestone ? msIds.get(w.milestone) : null,
        baselineStartDate: w.baseline ? d(w.baseline[0]) : null,
        baselineEndDate: w.baseline ? d(w.baseline[1]) : null,
        labelsCache: labels.map((n) => {
          const l = LABELS.find((x) => x.name === n)!;
          return { name: l.name, color: l.color };
        }),
        assigneesCache: (w.assignees ?? []).map(assignee),
        resourceAllocations: {
          create: (w.allocations ?? []).map((a) => ({
            gitlabUserId: a.gitlabUserId,
            allocationPercent: a.percent,
          })),
        },
      },
    });
    wpIds.set(w.key, created.id);
  }
  for (const w of WPS) {
    if (!w.parent) continue;
    await prisma.workPackage.update({
      where: { id: wpIds.get(w.key)! },
      data: { parentId: wpIds.get(w.parent)! },
    });
  }

  const seedDay = new Date();
  seedDay.setUTCHours(0, 0, 0, 0);
  for (const s of SPRINTS) {
    const done = [...WPS, ...STORIES].filter((w) => SPRINT_OF[w.key] === s.number && w.state === 'closed');
    await prisma.sprint.create({
      data: {
        projectId: project.id,
        number: s.number,
        name: s.name,
        goal: s.goal,
        state: s.state,
        startDate: addDays(seedDay, s.from),
        endDate: addDays(seedDay, s.to),
        startedAt: s.state === 'planned' ? null : addDays(seedDay, s.from),
        closedAt: s.state === 'closed' ? addDays(seedDay, s.to) : null,
        completedCount: s.state === 'closed' ? done.length : null,
        completedPoints:
          s.state === 'closed' ? done.reduce((sum, w) => sum + (w.story?.points ?? 0), 0) : null,
      },
    });
  }

  for (const t of TASKS) {
    const story = WPS.concat(STORIES).find((w) => w.key === t.story)!;
    await prisma.workPackage.create({
      data: {
        projectId: project.id,
        gitlabIssueIid: t.iid,
        titleCache: t.title,
        stateCache: t.closed === undefined ? 'opened' : 'closed',
        closedAt: t.closed === undefined ? null : addDays(seedDay, t.closed),
        startDate: d(story.start),
        endDate: d(story.end),
        isUnscheduled: true,
        isTask: true,
        storyId: wpIds.get(t.story)!,
        estimateSeconds: t.hours * 3600,
        labelsCache: t.column ? [{ name: `board::${t.column}` }] : [],
        assigneesCache: t.assignee ? [assignee(t.assignee)] : [],
      },
    });
  }

  // Review und Retro von Sprint 1. Eine Massnahme wurde ein Issue in Sprint 2
  // und ist erledigt, damit die nächste Retro den Kreis zeigt.
  const sprint1 = await prisma.sprint.findUniqueOrThrow({
    where: { projectId_number: { projectId: project.id, number: 1 } },
    select: { id: true },
  });
  await prisma.sprint.update({
    where: { id: sprint1.id },
    data: {
      goalOutcome: 'partly',
      reviewNotes:
        'Startseite und Kartenansicht gezeigt. Die Product Owner wünscht grössere Teaser-Bilder; das Newsletter-Formular wurde vorgezogen. Barrierefreiheit der Karte ist noch offen und kommt ins Backlog.',
    },
  });
  await prisma.workPackage.create({
    data: {
      projectId: project.id,
      gitlabIssueIid: 70,
      titleCache: 'Daily Scrum auf 15 Minuten begrenzen',
      descriptionCache: 'Massnahme aus der Retrospektive von Sprint 1.',
      stateCache: 'closed',
      closedAt: addDays(seedDay, -3),
      startDate: addDays(seedDay, -5),
      endDate: addDays(seedDay, 8),
      labelsCache: [{ name: 'retro' }, { name: 'sprint::2' }],
      assigneesCache: [],
    },
  });
  const RETRO: Array<{ kind: string; text: string; by: number; votes: number[]; issue?: number }> = [
    { kind: 'good', text: 'Pairing bei der Kartenansicht hat viel Zeit gespart', by: 105, votes: [101, 103] },
    { kind: 'good', text: 'Review mit der Product Owner direkt auf Staging', by: 101, votes: [102] },
    { kind: 'improve', text: 'Daily Scrum dauert oft 30 Minuten', by: 102, votes: [101, 104, 105] },
    { kind: 'improve', text: 'Stories kamen ohne Akzeptanzkriterien in den Sprint', by: 103, votes: [102, 103] },
    { kind: 'action', text: 'Daily Scrum mit Timer, höchstens 15 Minuten', by: 102, votes: [104], issue: 70 },
    { kind: 'action', text: 'Story ohne Akzeptanzkriterien kommt nicht ins Sprint Planning', by: 103, votes: [] },
  ];
  for (const r of RETRO) {
    await prisma.sprintRetroItem.create({
      data: {
        sprintId: sprint1.id,
        kind: r.kind,
        text: r.text,
        authorId: users.get(r.by),
        issueIid: r.issue ?? null,
        votes: { create: r.votes.map((v) => ({ userId: users.get(v)! })) },
      },
    });
  }

  // Cumulative Flow: erfundener, aber plausibler Verlauf der letzten 20 Tage.
  // Den heutigen Stand zählt die App selbst, sobald jemand das Board öffnet.
  for (let i = 20; i >= 1; i--) {
    const t = 20 - i; // 0 … 19
    // Endet nahe am echten Stand des Demo-Boards, damit der heutige Tag anschliesst.
    const done = 3 + Math.round(t * 0.32);
    const review = 1 + (t % 4 === 3 ? 1 : 0);
    const doing = 3 + Math.round(Math.sin(t / 3) + 1) + (t > 12 ? 1 : 0);
    const todo = 2 + (t % 5 === 0 ? 1 : 0);
    const backlog = 20 - Math.round(t * 0.3);
    await prisma.boardSnapshot.create({
      data: { projectId: project.id, date: addDays(seedDay, -i), counts: { backlog, todo, doing, review, done } },
    });
  }

  for (const j of JOURNAL) {
    await prisma.journalEntry.create({
      data: {
        projectId: project.id,
        userId: demoUserId,
        date: addDays(seedDay, j.day),
        hours: j.hours,
        title: j.title,
        technical: j.technical,
        organizational: j.organizational,
        nextSteps: j.nextSteps,
        suggestedBy: j.suggestedBy ?? null,
      },
    });
  }

  // Planning Poker: Bei der Merkliste haben drei schon verdeckt gelegt, Anna
  // (die Demo-Person) noch nicht.
  const pokerRound = await prisma.estimationRound.create({
    data: { projectId: project.id, workPackageId: wpIds.get('s7')!, number: 1, createdByUserId: users.get(102) },
  });
  for (const [gitlabUserId, value] of [[102, '5'], [103, '8'], [104, '13']] as const) {
    await prisma.estimationVote.create({
      data: { roundId: pokerRound.id, userId: users.get(gitlabUserId)!, value },
    });
  }

  for (const dep of DEPS) {
    await prisma.dependency.create({
      data: {
        predecessorId: wpIds.get(dep.from)!,
        successorId: wpIds.get(dep.to)!,
        type: dep.type ?? 'FS',
        lagDays: dep.lag ?? 0,
        createdByUserId: demoUserId,
      },
    });
  }

  for (const r of RISKS) {
    await prisma.risk.create({
      data: {
        projectId: project.id,
        title: r.title,
        category: r.category,
        probabilityPre: r.pre[0],
        impactPre: r.pre[1],
        probabilityPost: r.post ? r.post[0] : null,
        impactPost: r.post ? r.post[1] : null,
        status: r.status,
        mitigationPlan: r.mitigation ?? null,
        contingencyPlan: r.contingency ?? null,
        ownerUserId: r.owner ? users.get(r.owner) : null,
        linkedWps: { create: (r.wps ?? []).map((k) => ({ workPackageId: wpIds.get(k)! })) },
        linkedMs: { create: (r.ms ?? []).map((k) => ({ milestoneId: msIds.get(k)! })) },
      },
    });
  }

  // AuditLog-Einträge: der Velocity-Chart im Bericht leitet "erstellt" und
  // "geschlossen" pro Kalenderwoche daraus ab. Ohne diese Historie bliebe das
  // Diagramm leer. Anlage-Zeitpunkt ist jeweils gut zwei Wochen vor dem
  // geplanten Start, das Schliessen fällt auf das Enddatum.
  const auditRows: {
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    after: object;
    createdAt: Date;
  }[] = [];
  for (const w of WPS) {
    const id = wpIds.get(w.key)!;
    const createdAt = new Date(d(w.start).getTime() - 16 * 24 * 60 * 60 * 1000);
    auditRows.push({
      userId: demoUserId,
      action: 'work_package.create',
      entityType: 'WorkPackage',
      entityId: id,
      after: { title: w.title },
      createdAt,
    });
    if (w.state === 'closed') {
      auditRows.push({
        userId: demoUserId,
        action: 'work_package.update',
        entityType: 'WorkPackage',
        entityId: id,
        after: { state: 'closed' },
        createdAt: d(w.end),
      });
    }
  }
  await prisma.auditLog.createMany({ data: auditRows });

  return {
    projectId: project.id,
    workPackages: WPS.length + STORIES.length,
    milestones: MILESTONES.length,
    dependencies: DEPS.length,
    risks: RISKS.length,
  };
}

// Name der eingeloggten Demo-Nutzerin — für Log-Ausgaben und die Login-Seite.
export const DEMO_USER_NAME = PEOPLE[0].name;
