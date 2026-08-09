import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { parsePreferences } from '@/lib/preferences';
import { AppHeader, SubHeader } from '@/components/layout/AppHeader';
import { SettingsForm } from './SettingsForm';

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  });
  const prefs = parsePreferences(user?.preferences);

  return (
    <div className="app">
      <AppHeader username={session.user.username} />
      <SubHeader crumbs={['Einstellungen']} />
      <div
        style={{
          flex: 1,
          padding: '24px 24px 40px',
          overflow: 'auto',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 720,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <SettingsForm initialPrefs={prefs} />
        </div>
      </div>
    </div>
  );
}
