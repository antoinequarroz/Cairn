#!/usr/bin/env bash
# Restaure une sauvegarde de Cairn faite par backup.sh.
#
#   ./restore.sh <cairn-AAAA-MM-JJ_HHMM.tar.gz.age> -i <clé-privée-age.txt> [--check] [--yes]
#
#   --check  déchiffre et vérifie l'archive (intégrité de la base, nombre de notes), sans rien toucher.
#   --yes    ne demande pas de confirmation.
#
# La restauration arrête Cairn, met les données actuelles de côté dans le volume
# (/data/avant-restauration-<date>/, à supprimer une fois vérifié), installe la sauvegarde et relance.
set -euo pipefail
cd "$(dirname "$0")"

archive="" identity="${CAIRN_BACKUP_IDENTITY:-}" check=false yes=false
while [ $# -gt 0 ]; do
  case "$1" in
    -i | --identity) identity="$2"; shift 2 ;;
    --check) check=true; shift ;;
    --yes) yes=true; shift ;;
    -h | --help) sed -n '2,11p' "$0"; exit 0 ;;
    *) archive="$1"; shift ;;
  esac
done

[ -n "$archive" ] && [ -f "$archive" ] || { echo "Archive introuvable : « $archive ». Usage : ./restore.sh <archive.tar.gz.age> -i <clé.txt>" >&2; exit 1; }
[ -n "$identity" ] && [ -f "$identity" ] || { echo "Clé privée age introuvable (option -i, ou CAIRN_BACKUP_IDENTITY)." >&2; exit 1; }
command -v age >/dev/null || { echo "age n'est pas installé (apt install age)." >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
chmod 700 "$tmp"

echo "Déchiffrement…"
age -d -i "$identity" "$archive" | tar -xzf - -C "$tmp"
[ -f "$tmp/backup.db" ] || { echo "Archive invalide : backup.db manque." >&2; exit 1; }

# Vérifie la base avec le better-sqlite3 de l'image de Cairn (rien à installer sur la machine).
echo "Vérification…"
# Pas en lecture seule : SQLite crée un fichier -shm à côté d'une base en mode WAL, même pour la lire.
docker compose run --rm --no-deps -T --user root -v "$tmp:/restore" --entrypoint node cairn -e '
  const fs = require("fs");
  const db = require("better-sqlite3")("/restore/backup.db", { readonly: true });
  const ok = db.pragma("integrity_check", { simple: true });
  if (ok !== "ok") { console.error("Base abîmée : " + ok); process.exit(1); }
  const count = (t) => { try { return db.prepare("select count(*) as n from " + t).get().n; } catch { return 0; } };
  const has = (f) => fs.existsSync("/restore/" + f) ? "oui" : "non";
  const files = fs.existsSync("/restore/files") ? fs.readdirSync("/restore/files").length : 0;
  console.log("  base intacte : " + count("notes") + " notes, " + count("vault_items") + " éléments du coffre, " + count("conversations") + " discussions, " + files + " fichiers joints");
  console.log("  mot de passe changé dans l’app : " + has("auth.json") + " · double authentification : " + has("two-factor.json") + " · secret.key : " + has("secret.key"));
'

if [ "$check" = true ]; then
  echo "Archive valide. Rien n'a été modifié (--check)."
  exit 0
fi

if [ "$yes" != true ]; then
  read -r -p "Remplacer les données de Cairn par cette sauvegarde ? Tape « restaurer » : " answer
  [ "$answer" = "restaurer" ] || { echo "Annulé."; exit 1; }
fi

stamp="$(date +%Y-%m-%d_%H%M%S)"
echo "Arrêt de Cairn…"
docker compose stop cairn >/dev/null 2>&1 || true

echo "Installation de la sauvegarde…"
docker compose run --rm --no-deps -T --user root -e STAMP="$stamp" -v "$tmp:/restore:ro" --entrypoint sh cairn -c '
  set -e
  cd /data
  old="avant-restauration-$STAMP"
  mkdir "$old"
  for f in cairn.db cairn.db-wal cairn.db-shm files auth.json two-factor.json secret.key backup-status.json; do
    [ -e "$f" ] && mv "$f" "$old/"
  done
  rmdir "$old" 2>/dev/null || echo "  anciennes données mises de côté dans /data/$old"
  cp /restore/backup.db cairn.db
  cp -r /restore/files files 2>/dev/null || mkdir files
  for f in auth.json two-factor.json secret.key; do
    [ -e "/restore/$f" ] && cp "/restore/$f" "$f"
  done
  chown -R 1001:1001 /data
  chmod 600 auth.json two-factor.json secret.key 2>/dev/null || true
'

echo "Redémarrage…"
docker compose up -d cairn >/dev/null
echo "Restauré. Connecte-toi avec le mot de passe et, si elle était active, la double authentification d'alors."
