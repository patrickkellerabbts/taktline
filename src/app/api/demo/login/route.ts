/**
 * Login-Bypass für den Demo-Modus.
 *
 * Auth.js benutzt hier die Database-Session-Strategie: der Cookie enthält nur
 * einen Token, die eigentliche Session steht in der Session-Tabelle. Deshalb
 * reicht es, den Token aus dem Demo-Seed als Cookie zu setzen — `auth()`
 * findet die Session danach auf dem normalen Weg, ohne dass irgendein
 * Auth.js-Interna nachgebaut werden müsste.
 *
 * Ein Credentials-Provider wäre der naheliegendere Weg, verträgt sich in
 * Auth.js v5 aber schlecht mit `strategy: 'database'`.
 *
 * Die Route existiert nur, wenn DEMO_MODE=true gesetzt ist.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isDemoMode } from '@/lib/demo/mode';
import { DEMO_SESSION_TOKEN } from '@/lib/demo/constants';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

async function handler(request: Request) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: 'Nicht im Demo-Modus' }, { status: 404 });
  }

  // Die Session legt der Seed an. Fehlt sie, ist die DB noch nicht geseedet.
  const session = await prisma.session.findUnique({
    where: { sessionToken: DEMO_SESSION_TOKEN },
    select: { expires: true },
  });
  if (!session) {
    logger.warn('Demo-Login: keine Demo-Session in der DB — wurde geseedet?');
    return NextResponse.json(
      { error: 'Demo-Daten fehlen. Seed wurde noch nicht ausgeführt.' },
      { status: 503 },
    );
  }

  const url = new URL(request.url);

  // Auth.js leitet den Cookie-Namen aus dem Protokoll ab: unter HTTPS liest
  // es "__Secure-authjs.session-token", sonst "authjs.session-token". Wer den
  // falschen Namen setzt, bleibt ausgeloggt. Maßgeblich ist die öffentliche
  // URL (AUTH_URL) — hinter einem Reverse-Proxy ist die interne Request-URL
  // http, obwohl der Browser https spricht.
  const publicUrl = process.env.AUTH_URL ?? '';
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const useSecure = publicUrl.startsWith('https://')
    || forwardedProto === 'https'
    || url.protocol === 'https:';
  const cookieName = useSecure ? '__Secure-authjs.session-token' : 'authjs.session-token';

  const response = NextResponse.redirect(new URL('/projects', publicUrl || url.origin));
  response.cookies.set(cookieName, DEMO_SESSION_TOKEN, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: useSecure,
    expires: session.expires,
  });
  return response;
}

export const GET = handler;
export const POST = handler;
