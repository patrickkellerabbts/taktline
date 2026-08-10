/**
 * Demo-Modus: die App läuft ohne GitLab-Gegenstelle.
 *
 * Betrifft drei Dinge:
 *  1. `getGitlabClientForUser` liefert einen lokalen Stub statt eines echten
 *     API-Clients (siehe src/lib/gitlab/demo-client.ts)
 *  2. Der Login läuft über /api/demo/login statt über GitLab-OAuth
 *  3. Ein Auto-Reset setzt die Daten periodisch zurück (src/instrumentation.ts)
 *
 * Bewusst eine Funktion statt einer Konstante: process.env wird im Container
 * erst zur Laufzeit gesetzt, ein Modul-Level-Snapshot beim Build wäre falsch.
 */
export function isDemoMode(): boolean {
  return (process.env.DEMO_MODE ?? '').toLowerCase() === 'true';
}

/** Minuten zwischen zwei Auto-Resets. 0 oder negativ = kein Reset. */
export function demoResetIntervalMinutes(): number {
  const raw = Number(process.env.DEMO_RESET_INTERVAL_MINUTES ?? 60);
  return Number.isFinite(raw) ? raw : 60;
}
