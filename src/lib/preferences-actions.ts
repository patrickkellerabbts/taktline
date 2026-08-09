'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences, type UserPreferences } from '@/lib/preferences';

// Merge-Save: bestehende User.preferences werden gelesen, die neuen Felder
// drübergelegt, das Resultat zurückgeschrieben. Damit kollidieren parallele
// Updates aus verschiedenen Tabs nicht (jeder Tab schickt nur die Felder die
// er kennt). NICHT validieren — defensive parsing in parsePreferences fängt
// kaputte Werte beim nächsten Lesen ab.
export async function savePreferencesAction(patch: UserPreferences): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  const current = parsePreferences(user?.preferences);
  const next: UserPreferences = { ...current };
  // Nur definierte Felder übernehmen (undefined = "nicht ändern")
  if (patch.density !== undefined) next.density = patch.density;
  if (patch.showDeps !== undefined) next.showDeps = patch.showDeps;
  if (patch.showCrit !== undefined) next.showCrit = patch.showCrit;
  if (patch.showWeekends !== undefined) next.showWeekends = patch.showWeekends;
  if (patch.showBaseline !== undefined) next.showBaseline = patch.showBaseline;
  if (patch.filter !== undefined) next.filter = patch.filter;
  if (patch.zoom !== undefined) next.zoom = patch.zoom;
  if (patch.leftColWidth !== undefined) next.leftColWidth = patch.leftColWidth;
  if (patch.inspectorWidth !== undefined) next.inspectorWidth = patch.inspectorWidth;
  if (patch.leftListCollapsed !== undefined) next.leftListCollapsed = patch.leftListCollapsed;
  if (patch.closeInspectorOnEmptyClick !== undefined) {
    next.closeInspectorOnEmptyClick = patch.closeInspectorOnEmptyClick;
  }
  if (patch.lastOpenedProjectId !== undefined) {
    next.lastOpenedProjectId = patch.lastOpenedProjectId;
  }
  if (patch.pinchSensitivity !== undefined) next.pinchSensitivity = patch.pinchSensitivity;
  if (patch.pinchSmoothing !== undefined) next.pinchSmoothing = patch.pinchSmoothing;
  if (patch.pinchLockMs !== undefined) next.pinchLockMs = patch.pinchLockMs;

  await prisma.user.update({
    where: { id: session.user.id },
    data: { preferences: next },
  });
}
