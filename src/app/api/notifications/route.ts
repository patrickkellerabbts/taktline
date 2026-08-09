import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getNotifications } from '@/lib/notifications';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }
  const bundle = await getNotifications(
    session.user.id,
    session.user.gitlabUserId ?? null,
  );
  return Response.json(bundle, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

// DELETE markiert alle aktuellen Activity-Einträge als gesehen
// (notificationsLastSeenAt = now). Warnings/DueTasks bleiben unverändert —
// die sind State-basiert, nicht Event-basiert.
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }
  await prisma.user.update({
    where: { id: session.user.id },
    data: { notificationsLastSeenAt: new Date() },
  });
  return new Response(null, { status: 204 });
}
