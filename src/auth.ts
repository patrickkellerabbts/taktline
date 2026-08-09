import NextAuth from 'next-auth';
import GitLab from 'next-auth/providers/gitlab';
import { prisma } from '@/lib/db';
import { EncryptedPrismaAdapter } from '@/lib/auth/encrypted-adapter';
import { encryptToken } from '@/lib/auth/crypto';
import { logger } from '@/lib/logger';

const gitlabUrl = process.env.GITLAB_URL ?? 'https://gitlab.com';

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: EncryptedPrismaAdapter(prisma),
  trustHost: true,
  session: { strategy: 'database', maxAge: 7 * 24 * 60 * 60 }, // 7 Tage
  providers: [
    GitLab({
      clientId: process.env.GITLAB_CLIENT_ID,
      clientSecret: process.env.GITLAB_CLIENT_SECRET,
      baseUrl: gitlabUrl,
      // Auto-Link wenn die GitLab-Email auf einen bereits existierenden User
      // matched. Auth.js refused das standardmäßig (Security-Default für
      // multi-tenant SaaS). Für unser internes Single-Tenant-Tool akzeptabel:
      // dieselbe Email = dieselbe Person, die Verknüpfung ist gewollt.
      allowDangerousEmailAccountLinking: true,
      // Default des Providers ist nur "read_user" — wir brauchen "api" für Schreibzugriff.
      // URL muss explizit mit angegeben werden, sonst überschreibt das Objekt die
      // Default-URL und der Auth-Flow crasht ("Invalid URL").
      authorization: {
        url: `${gitlabUrl}/oauth/authorize`,
        params: { scope: 'read_user api' },
      },
      profile(profile) {
        return {
          id: String(profile.id ?? profile.sub),
          name: profile.name ?? profile.username ?? null,
          email: profile.email,
          image: profile.avatar_url ?? null,
          gitlabUserId: Number(profile.id ?? profile.sub),
          username: profile.username ?? null,
          avatarUrl: profile.avatar_url ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
        const enriched = await prisma.user.findUnique({
          where: { id: user.id },
          select: { gitlabUserId: true, username: true },
        });
        if (enriched) {
          session.user.gitlabUserId = enriched.gitlabUserId;
          session.user.username = enriched.username;
        }
      }
      return session;
    },
  },
  events: {
    // Bei jedem Sign-In die Account-Tokens mit den frischen OAuth-Tokens
    // überschreiben. Ohne diesen Hook ruft Auth.js v5 `linkAccount` NUR beim
    // ersten Verknüpfen — bei Re-Login bleiben die alten (oft abgelaufenen)
    // Tokens in der DB, und der Refresh-Flow scheitert wenn z.B. das
    // GitLab-OAuth-Application rotiert wurde.
    async signIn({ user, account }) {
      if (!user?.id || !account || account.provider !== 'gitlab') return;
      if (!account.access_token) return;

      try {
        await prisma.account.updateMany({
          where: { userId: user.id, provider: 'gitlab' },
          data: {
            access_token: encryptToken(account.access_token),
            refresh_token: account.refresh_token
              ? encryptToken(account.refresh_token)
              : null,
            expires_at: account.expires_at ?? null,
            scope: account.scope ?? null,
            token_type: account.token_type ?? null,
          },
        });
        logger.debug(
          { userId: user.id, expiresAt: account.expires_at },
          'OAuth-Tokens nach Sign-In aktualisiert',
        );
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err), userId: user.id },
          'Konnte OAuth-Tokens nach Sign-In nicht aktualisieren',
        );
      }
    },
  },
  pages: {
    signIn: '/login',
  },
});
