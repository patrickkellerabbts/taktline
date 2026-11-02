// Lese-Links für Personen ohne GitLab-Konto (z.B. Dozenten).
//
// Bewusst keine Session und kein User: alle Schreibaktionen verlangen auth() und
// lehnen Gäste dadurch von selbst ab, auch wenn in einer Ansicht einmal ein
// Bearbeiten-Knopf übersehen wird. Ein Link gilt für genau ein Projekt; die
// /share-Seiten laden nur dessen Daten und nie Risiken.
//
// In der DB liegt nur der SHA-256-Hash. Das Token hat 256 Bit Zufall, ein
// langsamer Hash oder Salt brächte deshalb nichts.
import { createHash, randomBytes } from 'node:crypto';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const LAST_USED_RESOLUTION_MS = 5 * 60_000;

export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type ActiveShareLink = {
  id: string;
  label: string;
  expiresAt: Date;
  projectId: string;
  projectName: string;
};

export async function resolveShareLink(token: string): Promise<ActiveShareLink | null> {
  if (!TOKEN_RE.test(token)) return null;
  const link = await prisma.shareLink.findUnique({
    where: { tokenHash: hashShareToken(token) },
    select: {
      id: true,
      label: true,
      expiresAt: true,
      revokedAt: true,
      projectId: true,
      project: { select: { nameCache: true } },
    },
  });
  const now = new Date();
  if (!link || link.revokedAt || link.expiresAt <= now) return null;

  // Grob genug, dass nicht jeder Seitenaufruf schreibt.
  await prisma.shareLink.updateMany({
    where: {
      id: link.id,
      OR: [
        { lastUsedAt: null },
        { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_RESOLUTION_MS) } },
      ],
    },
    data: { lastUsedAt: now },
  });

  return {
    id: link.id,
    label: link.label,
    expiresAt: link.expiresAt,
    projectId: link.projectId,
    projectName: link.project.nameCache,
  };
}

/** Für die /share-Seiten: ungültig, abgelaufen und widerrufen sehen gleich aus. */
export async function requireShareLink(token: string): Promise<ActiveShareLink> {
  const link = await resolveShareLink(token);
  if (!link) notFound();
  return link;
}
