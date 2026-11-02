// User Stories stehen als normales Markdown in der Issue-Description, damit sie
// in GitLab lesbar bleiben und die Checkboxen dort abgehakt werden können.
//
//   **Als** Redakteur **möchte ich** Beiträge planen, **damit** sie pünktlich erscheinen.
//
//   ### Akzeptanzkriterien
//
//   - [ ] Termin wählbar
//   - [x] Vorschau vorhanden
//
//   <freie Notizen>
//
// Was nicht diesem Muster folgt, landet beim Parsen in `notes` — fremder Text
// geht also nie verloren. Der gantt-meta-Block wird vorher abgetrennt.

export type StoryCriterion = { text: string; done: boolean };

export type StoryFields = {
  role: string;
  goal: string;
  benefit: string;
  criteria: StoryCriterion[];
  notes: string;
};

const CRITERIA_HEADING = '### Akzeptanzkriterien';
const SENTENCE_RE = /^\*\*Als\*\* (.+?) \*\*möchte ich\*\* (.+?)(?:, \*\*damit\*\* (.+?))?\.\s*$/;
const CHECKBOX_RE = /^- \[( |x|X)\] (.+?)\s*$/;

function inline(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
}

export function buildStoryDescription(fields: StoryFields): string {
  const parts: string[] = [];
  const role = inline(fields.role);
  const goal = inline(fields.goal);
  const benefit = inline(fields.benefit);
  if (role && goal) {
    parts.push(`**Als** ${role} **möchte ich** ${goal}${benefit ? `, **damit** ${benefit}` : ''}.`);
  }
  const criteria = fields.criteria
    .map((c) => ({ text: c.text.replace(/\s+/g, ' ').trim(), done: c.done }))
    .filter((c) => c.text);
  if (criteria.length > 0) {
    const lines = criteria.map((c) => `- [${c.done ? 'x' : ' '}] ${c.text}`);
    parts.push(`${CRITERIA_HEADING}\n\n${lines.join('\n')}`);
  }
  const notes = fields.notes.trim();
  if (notes) parts.push(notes);
  return parts.join('\n\n');
}

/** Erwartet die Description ohne gantt-meta-Block (siehe stripGanttMeta). */
export function parseStoryDescription(markdown: string | null | undefined): StoryFields {
  const fields: StoryFields = { role: '', goal: '', benefit: '', criteria: [], notes: '' };
  const lines = (markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const rest: string[] = [];

  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const sentence = lines[i]?.match(SENTENCE_RE);
  if (sentence) {
    fields.role = sentence[1];
    fields.goal = sentence[2];
    fields.benefit = sentence[3] ?? '';
    i++;
  }

  for (; i < lines.length; i++) {
    if (fields.criteria.length === 0 && lines[i].trim() === CRITERIA_HEADING) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const criteria: StoryCriterion[] = [];
      for (; j < lines.length; j++) {
        const match = lines[j].match(CHECKBOX_RE);
        if (!match) break;
        criteria.push({ text: match[2], done: match[1] !== ' ' });
      }
      if (criteria.length > 0) {
        fields.criteria = criteria;
        i = j - 1;
        continue;
      }
    }
    rest.push(lines[i]);
  }

  fields.notes = rest.join('\n').trim();
  return fields;
}

/** Bereits abgehakte Kriterien bleiben abgehakt, wenn ihr Text gleich bleibt. */
export function mergeCriteria(texts: readonly string[], previous: readonly StoryCriterion[]): StoryCriterion[] {
  const done = new Set(previous.filter((c) => c.done).map((c) => c.text));
  return texts
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text) => ({ text, done: done.has(text) }));
}
