/**
 * Gemeinsame Konstanten von Seed und Screenshot-Runner. Bewusst eine eigene
 * Datei ohne Seiteneffekte — der Runner braucht die Werte, aber nicht den
 * Prisma-Client aus seed-demo.ts.
 */

// Session-Token der Demo-Nutzerin. Der Screenshot-Runner setzt genau diesen
// Wert als Cookie und ist damit ohne GitLab-OAuth eingeloggt.
export const DEMO_SESSION_TOKEN = 'demo-session-taktline-screenshots';

// Feste Projekt-ID statt generiertem UUID, damit der Runner die URLs kennt
// ohne vorher die DB zu befragen.
export const DEMO_PROJECT_ID = '00000000-0000-4000-8000-000000000001';
