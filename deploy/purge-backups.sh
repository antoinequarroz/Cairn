#!/usr/bin/env bash
# Purge des anciennes sauvegardes, par exemple après avoir mis le cadenas sur une note qui était en clair :
# son ancienne version reste lisible (avec la clé privée age) dans les sauvegardes faites avant.
#
#   ./purge-backups.sh         # demande confirmation
#   ./purge-backups.sh --yes   # sans question
#
# 1. fait d'abord une sauvegarde neuve (backup.sh), qui ne contient plus que la version chiffrée ;
# 2. si elle a réussi, supprime toutes les autres, ici et sur CAIRN_BACKUP_REMOTE.
# Tu perds les points de restauration plus anciens : il ne reste que celui de maintenant.
set -euo pipefail
cd "$(dirname "$0")"

conf() {
  local name="$1" default="${2:-}" value="${!1:-}"
  if [ -z "$value" ] && [ -f .env ]; then
    value="$(grep -E "^${name}=" .env | tail -n1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')" || true
  fi
  printf '%s' "${value:-$default}"
}

remote="$(conf CAIRN_BACKUP_REMOTE)"
dest="$(conf CAIRN_BACKUP_DIR "$HOME/cairn-backups")"

if [ "${1:-}" != "--yes" ]; then
  echo "Une sauvegarde neuve va être faite, puis TOUTES les autres seront supprimées :"
  echo "  - dans $dest"
  [ -n "$remote" ] && echo "  - sur $remote"
  read -r -p "Continuer ? (oui/non) " answer
  [ "$answer" = "oui" ] || { echo "Rien n'a été supprimé."; exit 1; }
fi

./backup.sh
latest="$(ls -1t "$dest"/cairn-*.tar.gz.age 2>/dev/null | head -n1)"
[ -n "$latest" ] || { echo "Pas de sauvegarde neuve trouvée : rien n'a été supprimé." >&2; exit 1; }
name="$(basename "$latest")"

find "$dest" -maxdepth 1 -name 'cairn-*.tar.gz*' ! -name "$name" -print -delete
if [ -n "$remote" ]; then
  rclone delete "${remote%/}" --filter "- $name" --filter "+ cairn-*.tar.gz*" --filter "- *" -v
fi
echo "Il ne reste que $name. Si ton stockage garde une corbeille ou des versions, vide-la aussi."
