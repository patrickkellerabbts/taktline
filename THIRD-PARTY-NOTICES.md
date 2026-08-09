# Third-Party Notices

Taktline nutzt die folgenden Open-Source-Bibliotheken. Alle aufgelisteten
Pakete stehen unter permissiven Lizenzen (MIT / Apache-2.0 / ISC / BSD-2-
Clause / OFL-1.1) — keine Copyleft-Pflichten.

Diese Liste deckt direkte Dependencies ab. Transitive Dependencies findest
du via `npm ls --all` bzw. `npm ls --omit=dev` für Production-Subset.

## Production-Dependencies

| Paket | Version-Range | Lizenz |
|---|---|---|
| [next](https://github.com/vercel/next.js) | 16.2.6 | MIT |
| [react](https://github.com/facebook/react) | ^19.2.6 | MIT |
| [react-dom](https://github.com/facebook/react) | ^19.2.6 | MIT |
| [next-auth](https://github.com/nextauthjs/next-auth) | ^5.0.0-beta.31 | ISC |
| [@auth/prisma-adapter](https://github.com/nextauthjs/next-auth) | ^2.11.2 | ISC |
| [@prisma/client](https://github.com/prisma/prisma) | ^7.8.0 | Apache-2.0 |
| [@prisma/adapter-pg](https://github.com/prisma/prisma) | ^7.8.0 | Apache-2.0 |
| [@gitbeaker/rest](https://github.com/jdalrymple/gitbeaker) | ^43.8.0 | Apache-2.0 |
| [lucide-react](https://github.com/lucide-icons/lucide) | ^1.16.0 | ISC |
| [pg](https://github.com/brianc/node-postgres) | ^8.21.0 | MIT |
| [pino](https://github.com/pinojs/pino) | ^10.3.1 | MIT |
| [yaml](https://github.com/eemeli/yaml) | ^2.9.0 | ISC |
| [zod](https://github.com/colinhacks/zod) | ^4.4.3 | MIT |

## Dev-Dependencies

| Paket | Version-Range | Lizenz |
|---|---|---|
| [prisma](https://github.com/prisma/prisma) | ^7.8.0 | Apache-2.0 |
| [typescript](https://github.com/microsoft/TypeScript) | ^5 | Apache-2.0 |
| [tailwindcss](https://github.com/tailwindlabs/tailwindcss) | ^4 | MIT |
| [@tailwindcss/postcss](https://github.com/tailwindlabs/tailwindcss) | ^4 | MIT |
| [eslint](https://github.com/eslint/eslint) | ^9 | MIT |
| [eslint-config-next](https://github.com/vercel/next.js) | 16.2.6 | MIT |
| [pino-pretty](https://github.com/pinojs/pino-pretty) | ^13.1.3 | MIT |
| [dotenv](https://github.com/motdotla/dotenv) | ^17.4.2 | BSD-2-Clause |
| [@types/*](https://github.com/DefinitelyTyped/DefinitelyTyped) | div. | MIT |

## Fonts

| Font | Quelle | Lizenz |
|---|---|---|
| [Inter](https://github.com/rsms/inter) | Google Fonts via `next/font` | SIL Open Font License 1.1 |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | Google Fonts via `next/font` | SIL Open Font License 1.1 |

## Custom Code

Der Gantt-Renderer (`src/components/gantt/GanttView.tsx`), Inspector,
Critical-Path-Algorithmus, Resource-Matrix, Reports und alle anderen
Komponenten sind Eigen-Implementierungen unter der MIT-Lizenz dieses
Projekts (siehe [LICENSE](LICENSE)). Es wurde kein GPL- oder LGPL-
lizensiertes Gantt-Library verwendet.
