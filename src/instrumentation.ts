// Next.js Startup-Hook (App Router). Wird einmal pro Server-Instanz aufgerufen,
// bevor der Server Requests annimmt.
// Hier registrieren wir den Reconciliation-Scheduler.

export async function register() {
  // Nur im Node.js-Runtime, nicht in Edge. instrumentation.ts läuft in beiden
  // Runtimes, aber Prisma + Pino brauchen Node.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Dev: HMR und Multi-Worker können register() mehrfach feuern.
  // Globaler Guard verhindert doppelte Intervals beim Edit-Reload-Zyklus.
  // (Node 'global' ist hot-reload-stabil; lokale Module-Variablen sind es nicht.)
  const g = globalThis as unknown as { __taktline_recon_started?: boolean };
  if (g.__taktline_recon_started) return;
  g.__taktline_recon_started = true;

  // Demo-Modus: es gibt keine GitLab-Gegenstelle, gegen die reconciled werden
  // könnte. Stattdessen läuft der periodische Reset der Beispieldaten.
  const { isDemoMode } = await import('./lib/demo/mode');
  if (isDemoMode()) {
    await startDemoReset();
    return;
  }

  const enabled = (process.env.RECONCILIATION_ENABLED ?? 'true').toLowerCase() === 'true';
  const intervalMinutes = Number(process.env.RECONCILIATION_INTERVAL_MINUTES ?? 15);

  if (!enabled) {
    const { logger } = await import('./lib/logger');
    logger.info('Reconciliation: deaktiviert via RECONCILIATION_ENABLED=false');
    return;
  }

  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
    const { logger } = await import('./lib/logger');
    logger.warn(
      { intervalMinutes },
      'Reconciliation: ungültiges RECONCILIATION_INTERVAL_MINUTES — fallback auf 15',
    );
  }

  const intervalMs = Math.max(1, intervalMinutes || 15) * 60_000;

  // Dynamic import damit der Reconciliation-Code (mit Prisma-Abhängigkeit)
  // nicht in den Edge-Bundle landet.
  const { reconcileAllProjects } = await import('./lib/gitlab/reconciliation');
  const { logger } = await import('./lib/logger');

  logger.info(
    { intervalMinutes: intervalMs / 60_000 },
    'Reconciliation: Scheduler aktiviert',
  );

  // Erster Tick nach 60s — gibt dem Server Zeit, vollständig hochzufahren.
  // Danach im konfigurierten Interval.
  setTimeout(() => {
    void runOnce();
    setInterval(runOnce, intervalMs);
  }, 60_000);

  async function runOnce() {
    try {
      await reconcileAllProjects();
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Reconciliation: unerwarteter Fehler im Scheduler',
      );
    }
  }
}

/**
 * Demo-Betrieb: alle Besucher teilen sich einen Datenstand. Damit die Demo
 * nicht dauerhaft verbastelt bleibt, wird sie periodisch neu aufgesetzt.
 *
 * Beim Start wird immer einmal geseedet — so ist ein frisch hochgefahrener
 * Container ohne manuellen Schritt benutzbar, und ein leeres Volume genügt.
 */
async function startDemoReset() {
  const { demoResetIntervalMinutes } = await import('./lib/demo/mode');
  const { seedDemoData } = await import('./lib/demo/seed');
  const { resetDemoNotes } = await import('./lib/gitlab/demo-client');
  const { prisma } = await import('./lib/db');
  const { logger } = await import('./lib/logger');

  const minutes = demoResetIntervalMinutes();

  async function reseed(reason: string) {
    try {
      const r = await seedDemoData(prisma);
      // Die Kommentare liegen prozesslokal, nicht in der DB — separat zurücksetzen.
      const project = await prisma.project.findUnique({
        where: { id: r.projectId },
        select: { gitlabProjectId: true },
      });
      if (project) resetDemoNotes(project.gitlabProjectId);
      logger.info({ reason, ...r }, 'Demo: Daten zurückgesetzt');
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Demo: Reset fehlgeschlagen',
      );
    }
  }

  await reseed('startup');

  if (minutes > 0) {
    logger.info({ intervalMinutes: minutes }, 'Demo: Auto-Reset aktiviert');
    setInterval(() => void reseed('interval'), minutes * 60_000);
  } else {
    logger.info('Demo: Auto-Reset deaktiviert (DEMO_RESET_INTERVAL_MINUTES <= 0)');
  }
}
