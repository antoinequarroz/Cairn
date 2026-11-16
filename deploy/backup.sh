#!/usr/bin/env bash
# Sauvegarde de Cairn : la base (notes, coffre chiffré) et les fichiers joints.
#   ./backup.sh [dossier de destination]
# À lancer chaque nuit avec cron, puis à copier hors du VPS (le coffre y est déjà chiffré).
set -euo pipefail
cd "$(dirname "$0")"

dest="${1:-$HOME/cairn-backups}"
stamp="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$dest"

# Copie cohérente de la base, même pendant que l'app écrit, puis archive avec les fichiers joints.
docker compose exec -T cairn sh -c '
  set -e
  cd /app
  node -e "const db = require(\"better-sqlite3\")(\"/data/cairn.db\", { readonly: true }); db.backup(\"/data/backup.db\").then(() => db.close())"
  cd /data
  tar -czf - backup.db files $(ls auth.json 2>/dev/null)
  rm -f backup.db
' > "$dest/cairn-$stamp.tar.gz"

# Garde les 14 dernières sauvegardes.
ls -1t "$dest"/cairn-*.tar.gz | tail -n +15 | xargs -r rm --
echo "Sauvegarde : $dest/cairn-$stamp.tar.gz"
