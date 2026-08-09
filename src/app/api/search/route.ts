import { auth } from '@/auth';
import { searchEverything } from '@/lib/search';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }
  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? '';
  const results = await searchEverything(q);
  return Response.json(results, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
