#!/bin/sh
set -e

echo "▶ Applying database migrations…"
# Prisma-CLI + Config liegen in /opt/prisma-cli (separates Layer, damit das
# App-Image schlank bleibt). Wir wechseln dorthin für migrate deploy, das
# prisma.config.ts und ./prisma/migrations findet, und kehren danach für
# `node server.js` ins /app-Verzeichnis zurück.
(cd /opt/prisma-cli && node ./node_modules/prisma/build/index.js migrate deploy)

echo "▶ Starting Taktline on port ${PORT:-3043}…"
exec "$@"
