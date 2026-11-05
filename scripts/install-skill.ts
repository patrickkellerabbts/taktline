/**
 * Installiert den Taktline-Skill global für Claude Code.
 *
 * Die CLI wird zu einer einzigen Datei gebündelt, damit sie aus jedem Repo läuft
 * und nicht davon abhängt, welcher Branch hier gerade ausgecheckt ist.
 *
 * Aufruf: npm run skill:install
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const target = join(homedir(), '.claude', 'skills', 'taktline');
const config = join(homedir(), '.config', 'taktline', 'agent.env');

async function main() {
  mkdirSync(target, { recursive: true });
  await build({
    entryPoints: [join(root, 'scripts', 'taktline-cli.ts')],
    outfile: join(target, 'taktline.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20.12',
    logLevel: 'warning',
    // Gebündelte CommonJS-Pakete rufen require() auf, das es in ESM nicht gibt.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
    },
  });
  copyFileSync(join(root, 'skills', 'taktline', 'SKILL.md'), join(target, 'SKILL.md'));

  console.log(`Skill installiert: ${target}`);
  if (!existsSync(config)) {
    console.log(`Es fehlen noch die Zugangsdaten in ${config}:`);
    console.log('  GITLAB_URL=https://gitlab.example.com');
    console.log('  GITLAB_TOKEN=<Token eines Agent-Kontos mit Developer-Rolle>');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
