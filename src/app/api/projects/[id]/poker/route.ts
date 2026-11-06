import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { loadPokerState, touchPresence } from '@/lib/agile/poker-state';

// Wird von der Poker-Seite alle paar Sekunden abgefragt. Gleichzeitig der
// Herzschlag für die Anwesenheit am Tisch.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Nicht angemeldet' }, { status: 401 });

  const { id } = await params;
  const story = new URL(request.url).searchParams.get('story');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, username: true, avatarUrl: true },
  });
  if (!user) return Response.json({ error: 'Nicht angemeldet' }, { status: 401 });
  touchPresence(
    id,
    { userId: user.id, name: user.name ?? user.username ?? 'Unbekannt', avatarUrl: user.avatarUrl },
    story,
  );

  const state = await loadPokerState(id, user.id, story);
  if (!state) return Response.json({ error: 'Projekt nicht gefunden' }, { status: 404 });
  return Response.json(state, { headers: { 'Cache-Control': 'no-store' } });
}
