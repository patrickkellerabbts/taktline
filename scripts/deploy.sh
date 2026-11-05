#!/usr/bin/env bash
# Taktline auf dem Server aktualisieren: Code holen, Datenbank sichern, neu
# bauen, starten und prüfen, ob die App wieder antwortet.
#
# Aufruf im Repo-Verzeichnis auf dem Server:
#   ./scripts/deploy.sh            neuesten Stand von main deployen
#   ./scripts/deploy.sh --prune    danach alte, unbenutzte Images löschen
#
# Compose-Dateien kommen wie gewohnt aus COMPOSE_FILE in der .env.
# Backups landen in BACKUP_DIR (Standard: /srv/taktline/backup).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/taktline/backup}"
KEEP_BACKUPS=10
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
PRUNE=false

for arg in "$@"; do
  case "$arg" in
    --prune) PRUNE=true ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unbekannte Option: $arg" >&2; exit 1 ;;
  esac
done

cd "$(dirname "$0")/.."

step() { printf '\n▶ %s\n' "$1"; }
die() { printf '\n✖ %s\n' "$1" >&2; exit 1; }

app_healthy() {
  docker compose exec -T app node -e \
    "fetch('http://localhost:3043/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1
}

step "Vorbedingungen prüfen"
[ -f .env ] || die "Keine .env gefunden. Bitte im Taktline-Verzeichnis ausführen."
# Nur versionierte Dateien zählen: .env und compose.local.yml dürfen lokal sein.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no
  die "Es gibt lokale Änderungen an versionierten Dateien. Bitte erst sichern oder zurücksetzen."
fi
OLD_SHA=$(git rev-parse --short HEAD)
echo "Aktuelle Version: $OLD_SHA"

step "Code holen"
git pull --ff-only
NEW_SHA=$(git rev-parse --short HEAD)
if [ "$OLD_SHA" = "$NEW_SHA" ]; then
  echo "Schon aktuell ($NEW_SHA). Das Image wird trotzdem neu gebaut."
else
  git log --oneline "$OLD_SHA..$NEW_SHA" | sed 's/^/  /'
fi

step "Arbeitsspeicher"
free -h 2>/dev/null | sed -n '1,2p' || true

step "Image bauen (Taktline läuft währenddessen weiter)"
BUILD_SHA="$NEW_SHA" docker compose build app

step "Datenbank sichern"
mkdir -p "$BACKUP_DIR"
# Läuft die Datenbank gerade nicht, wäre kein Backup möglich.
docker compose up -d --wait postgres
BACKUP="$BACKUP_DIR/vor-deploy-$(date +%F-%H%M)-$OLD_SHA.sql.gz"
# User und Datenbank aus der Umgebung des Postgres-Containers, damit eigene
# Werte aus der .env automatisch passen.
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$BACKUP"
gunzip -t "$BACKUP" || die "Das Backup ist beschädigt. Abbruch, es wurde nichts umgestellt."
echo "Backup: $BACKUP ($(du -h "$BACKUP" | cut -f1))"
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/vor-deploy-*.sql.gz 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm --

step "Neue Version starten (Migrationen laufen automatisch)"
BUILD_SHA="$NEW_SHA" docker compose up -d

step "Warten, bis Taktline antwortet"
for ((waited = 0; waited < HEALTH_TIMEOUT; waited += 5)); do
  if app_healthy; then
    printf '\n✔ Taktline %s läuft (vorher %s).\n' "$NEW_SHA" "$OLD_SHA"
    if [ "$PRUNE" = true ]; then
      step "Alte Images aufräumen"
      docker image prune -f
    fi
    exit 0
  fi
  sleep 5
done

docker compose logs --tail 40 app
cat >&2 <<MSG

✖ Taktline antwortet nach ${HEALTH_TIMEOUT}s nicht. Die Logs stehen oben.

Zurück zur vorherigen Version:
  git checkout $OLD_SHA
  BUILD_SHA=$OLD_SHA docker compose up -d --build
  git checkout main          # später, um wieder auf den aktuellen Stand zu kommen

Datenbank auf den Stand vor dem Deploy zurücksetzen, nur falls eine Migration
Daten beschädigt hat (überschreibt alles seit dem Backup):
  docker compose stop app
  docker compose exec -T postgres sh -c 'dropdb -U "\$POSTGRES_USER" "\$POSTGRES_DB" && createdb -U "\$POSTGRES_USER" "\$POSTGRES_DB"'
  gunzip -c $BACKUP | docker compose exec -T postgres sh -c 'psql -U "\$POSTGRES_USER" "\$POSTGRES_DB"'
MSG
exit 1
