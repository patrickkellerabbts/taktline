/**
 * Installiert den Taktline-Skill global für Claude Code.
 *
 * Die CLI wird zu einer einzigen Datei gebündelt, damit sie aus jedem Repo läuft
 * und nicht davon abhängt, welcher Branch hier gerade ausgecheckt ist.
 *
 * Aufruf: npm run skill:install
 */
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
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
    // pdfkit (Gantt/PSP als PDF) liest seine Schriftmetriken über __dirname.
    // Die echte pdfkit-Datei statt der ES-Variante nehmen, damit das passt.
    mainFields: ['main'],
    // Gebündelte CommonJS-Pakete rufen require() und __dirname auf, die es in
    // ESM nicht gibt. __dirname zeigt auf den Skill-Ordner, dort liegt data/.
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        "import { dirname as __pathDirname } from 'node:path';",
        "import { fileURLToPath as __fileURLToPath } from 'node:url';",
        'const require = __createRequire(import.meta.url);',
        'const __dirname = __pathDirname(__fileURLToPath(import.meta.url));',
      ].join('\n'),
    },
  });
  copyFileSync(join(root, 'skills', 'taktline', 'SKILL.md'), join(target, 'SKILL.md'));
  cpSync(join(root, 'node_modules', 'pdfkit', 'js', 'data'), join(target, 'data'), { recursive: true });

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
