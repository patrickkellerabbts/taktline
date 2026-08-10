/**
 * Screenshot-Runner für die Doku-Bilder in docs/screenshots/.
 *
 * Setzt voraus, dass `npm run demo:seed` gelaufen ist und ein Dev-Server gegen
 * dieselbe Demo-DB läuft (`npm run demo:dev`). Der Login wird übersprungen,
 * indem der Session-Cookie direkt auf den Token aus dem Seed gesetzt wird.
 *
 * Aufruf: npm run demo:screenshots
 */
import { chromium, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { DEMO_SESSION_TOKEN, DEMO_PROJECT_ID } from '../src/lib/demo/constants';

const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://localhost:3043';
const OUT_DIR = 'docs/screenshots';

// 1600×1000 @2x — scharf auf Retina, in der README-Spalte noch handlich.
const VIEWPORT = { width: 1600, height: 1000 };

type Shot = {
  file: string;
  path: string;
  description: string;
  // Abweichende Fenstergrösse — Seiten mit wenig Inhalt bekommen sonst einen
  // grossen leeren Bereich unter der eigentlichen Darstellung.
  viewport?: { width: number; height: number };
  // Optionaler Schritt vor dem Auslösen (Panel öffnen, Element anklicken …).
  prepare?: (page: Page) => Promise<void>;
};

const SHOTS: Shot[] = [
  {
    file: 'gantt-overview.png',
    path: `/projects/${DEMO_PROJECT_ID}/gantt`,
    description: 'Gantt mit Hierarchie, Dependency-Pfeilen und Inspector',
    prepare: async (page) => {
      // Eine Aufgabe auswählen, damit der Inspector mit Inhalt statt mit dem
      // Leer-Hinweis im Bild landet.
      await page.getByText('Startseite umsetzen', { exact: true }).first().click();
      await page.waitForTimeout(600);
    },
  },
  {
    file: 'risk-matrix.png',
    path: `/projects/${DEMO_PROJECT_ID}/risks`,
    description: '5×5-Risikomatrix mit Drag-and-Drop',
  },
  {
    file: 'resources.png',
    path: `/projects/${DEMO_PROJECT_ID}/resources`,
    description: 'Ressourcen-Heatmap über alle Zuständigen',
    viewport: { width: 1600, height: 460 },
  },
  {
    file: 'reports.png',
    path: `/reports?project=${DEMO_PROJECT_ID}`,
    description: 'Bericht: Fortschritt, Meilenstein-Status, Konflikte',
  },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // --lang steuert die UI-Sprache von Chromium selbst; ohne das rendern
  // <input type="date">-Felder im US-Format, unabhängig vom Context-Locale.
  const browser = await chromium.launch({ args: ['--lang=de-DE'] });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: 'de-DE',
    timezoneId: 'Europe/Zurich',
    colorScheme: 'light',
  });

  // Auth.js legt die Session in der DB ab; der Cookie enthält nur den Token.
  // Ohne https heisst er unprefixed `authjs.session-token`.
  const { hostname } = new URL(BASE_URL);
  await context.addCookies([
    {
      name: 'authjs.session-token',
      value: DEMO_SESSION_TOKEN,
      domain: hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();

  for (const shot of SHOTS) {
    const url = `${BASE_URL}${shot.path}`;
    process.stdout.write(`→ ${shot.file} … `);
    await page.setViewportSize(shot.viewport ?? VIEWPORT);
    const res = await page.goto(url, { waitUntil: 'networkidle' });

    if (page.url().includes('/login')) {
      throw new Error(
        `Auf /login umgeleitet — Session-Cookie greift nicht. Lief "npm run demo:seed" gegen dieselbe DB wie der Dev-Server?`,
      );
    }
    if (res && !res.ok()) {
      throw new Error(`${url} antwortete mit HTTP ${res.status()}`);
    }

    // Das Dev-Overlay von Next (Logo-Badge unten links) gehört nicht in die
    // Doku-Bilder — der DEMO-Chip im Header ebenso wenig: die Bilder zeigen
    // die App, nicht den Betriebsmodus, in dem sie aufgenommen wurde.
    await page.addStyleTag({
      content: 'nextjs-portal, [data-demo-chip] { display: none !important; }',
    });

    await shot.prepare?.(page);
    // Kurz durchatmen: der Gantt misst seine Container erst nach dem Mount
    // und rendert die Timeline dann mit finaler Breite.
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT_DIR}/${shot.file}` });
    console.log('ok');
  }

  await browser.close();
  console.log(`\n✓ ${SHOTS.length} Screenshots in ${OUT_DIR}/`);
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
