/**
 * CLI-Wrapper um den Demo-Seed für die lokale Entwicklung.
 *
 * Die eigentliche Logik liegt in src/lib/demo/seed.ts, damit auch der
 * Demo-Server sie aufrufen kann (dort gibt es kein tsx und kein scripts/).
 *
 * Aufruf: npm run demo:seed
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedDemoData, DEMO_USER_NAME } from '../src/lib/demo/seed';
import { DEMO_SESSION_TOKEN } from '../src/lib/demo/constants';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL ist nicht gesetzt');

// Schutz vor Fehlgriffen: der Seed leert alle Tabellen. Ohne diesen Check
// wäre ein vergessenes DATABASE_URL-Prefix genug, um die Dev-DB zu leeren.
if (!/taktline_demo|demo/i.test(connectionString) && process.env.DEMO_SEED_FORCE !== '1') {
  throw new Error(
    `DATABASE_URL zeigt nicht auf eine Demo-Datenbank ("${connectionString.replace(/:[^:@]*@/, ':***@')}").\n` +
      'Der Seed leert alle Tabellen — Abbruch. Mit DEMO_SEED_FORCE=1 überstimmbar.',
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  console.log('→ Demo-Daten werden geschrieben …');
  const r = await seedDemoData(prisma);
  console.log(`✓ Projekt ${r.projectId}`);
  console.log(
    `  ${r.workPackages} Work Packages, ${r.milestones} Meilensteine, ` +
      `${r.dependencies} Dependencies, ${r.risks} Risiken`,
  );
  console.log(`✓ Login als ${DEMO_USER_NAME} — Session-Token: ${DEMO_SESSION_TOKEN}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
