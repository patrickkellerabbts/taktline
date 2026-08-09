// Manuell-Trigger für die Reconciliation. Geschützt durch RECONCILIATION_SECRET
// im Authorization-Header (Bearer-Token). Erlaubt Testen ohne 15min zu warten.
//
//   curl -X POST -H "Authorization: Bearer $RECONCILIATION_SECRET" \
//        https://<host>/api/admin/reconcile
//
// Optional: `?projectId=<uuid>` für Single-Projekt-Sync.

import { reconcileAllProjects, reconcileProject } from '@/lib/gitlab/reconciliation';
import { logger } from '@/lib/logger';

function unauthorized() {
  return new Response('Unauthorized', { status: 401 });
}

function checkAuth(request: Request): boolean {
  const secret = process.env.RECONCILIATION_SECRET;
  if (!secret) return false; // ohne konfiguriertes Secret immer verweigern
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return false;
  const provided = header.slice(7).trim();
  // Kein constant-time-compare nötig: Secret wird via Env gesetzt, kein
  // Brute-Force-Risiko bei internem Service.
  return provided === secret;
}

export async function POST(request: Request) {
  if (!checkAuth(request)) return unauthorized();

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');

  logger.info({ projectId: projectId ?? 'all' }, 'Admin: Reconciliation manuell getriggert');

  try {
    if (projectId) {
      const result = await reconcileProject(projectId);
      return Response.json(result, { status: result.ok ? 200 : 500 });
    }
    const result = await reconcileAllProjects();
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
