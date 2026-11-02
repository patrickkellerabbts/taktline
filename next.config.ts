import type { NextConfig } from 'next';
import { execSync } from 'node:child_process';

// Build-Info als ENV-Vars injizieren — die /about-Seite zeigt sie an.
// SHA aus git lesen; fällt auf "unknown" zurück falls git nicht verfügbar
// ist (z.B. im Docker-Builder ohne .git-Verzeichnis). BUILD_SHA-Env-Var
// kann das Fallback überschreiben (in CI/Docker setzen).
function readGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return process.env.BUILD_SHA ?? 'unknown';
  }
}

const buildSha = readGitSha();
const buildTime = new Date().toISOString();

const nextConfig: NextConfig = {
  // Standalone-Output: kompakter self-contained Build für Docker-Container
  // (~150 MB statt ~1 GB). Erzeugt .next/standalone/server.js als Entry-Point.
  output: 'standalone',
  // Das Token steht im Pfad von /share: nicht per Referrer weitergeben, nicht
  // indexieren, nichts zwischenspeichern (ein Widerruf muss sofort greifen).
  async headers() {
    return [
      {
        source: '/share/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_BUILD_SHA: buildSha,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
};

export default nextConfig;
