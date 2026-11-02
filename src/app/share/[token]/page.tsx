import { redirect } from 'next/navigation';
import { requireShareLink } from '@/lib/share/links';

export const dynamic = 'force-dynamic';

export default async function ShareIndexPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await requireShareLink(token);
  redirect(`/share/${token}/gantt`);
}
