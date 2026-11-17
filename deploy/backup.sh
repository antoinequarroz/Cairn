#!/usr/bin/env bash
# Sauvegarde chiffrée de Cairn : la base (notes, coffre), les fichiers joints et les clés du serveur.
#
#   ./backup.sh            # à lancer chaque nuit avec cron (docs/DEPLOIEMENT.md, étape 5)
#
# Réglages dans deploy/.env (voir .env.example) :
#   CAIRN_BACKUP_RECIPIENTS  clé(s) publique(s) age « age1… » : obligatoire. La clé privée n'est PAS sur
#                            le VPS : quelqu'un qui le prend ne peut pas lire les sauvegardes.
#   CAIRN_BACKUP_REMOTE      destination rclone hors du VPS (ex. « storagebox:cairn »). Vide : locale seulement.
#   CAIRN_BACKUP_KEEP_DAYS   jours gardés, ici et sur la destination (30 par défaut).
#   CAIRN_BACKUP_DIR         dossier local ($HOME/cairn-backups par défaut).
#
# Le résultat est signalé à l'app (Réglages > Sécurité), réussite ou échec.
set -euo pipefail
cd "$(dirname "$0")"

# Lit une valeur de deploy/.env sans exécuter le fichier. L'environnement a la priorité.
conf() {
  local name="$1" default="${2:-}" value="${!1:-}"
  if [ -z "$value" ] && [ -f .env ]; then
    value="$(grep -E "^${name}=" .env | tail -n1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')" || true
  fi
  printf '%s' "${value:-$default}"
}

recipients="$(conf CAIRN_BACKUP_RECIPIENTS)"
remote="$(conf CAIRN_BACKUP_REMOTE)"
keep_days="$(conf CAIRN_BACKUP_KEEP_DAYS 30)"
dest="$(conf CAIRN_BACKUP_DIR "$HOME/cairn-backups")"
stamp="$(date +%Y-%m-%d_%H%M)"
name="cairn-$stamp.tar.gz.age"
offsite=false

# Écrit l'état dans le volume de l'app (/data/backup-status.json). Un échec garde la date de la dernière réussite.
report() {
  docker compose exec -T -e STATUS="$1" cairn node -e '
    const fs = require("fs"), f = "/data/backup-status.json";
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
    const s = JSON.parse(process.env.STATUS);
    s.at = new Date().toISOString();
    if (!s.ok && (prev.ok ? prev.at : prev.lastOkAt)) s.lastOkAt = prev.ok ? prev.at : prev.lastOkAt;
    fs.writeFileSync(f + ".tmp", JSON.stringify(s), { mode: 0o600 });
    fs.renameSync(f + ".tmp", f);
  ' >/dev/null 2>&1 || echo "(état non transmis à l'app : Cairn tourne-t-il ?)" >&2
}

step="préparation"
fail() {
  local msg="échec pendant : $step"
  echo "Sauvegarde ratée, $msg" >&2
  rm -f "$dest/$name.partial"
  report "$(printf '{"ok":false,"error":"%s"}' "$msg")"
  exit 1
}
trap fail ERR

if [ -z "$recipients" ]; then
  step="configuration (CAIRN_BACKUP_RECIPIENTS manque dans deploy/.env)"
  false
fi
step="vérification de age"
command -v age >/dev/null

mkdir -p "$dest"
chmod 700 "$dest"

args=()
for r in $recipients; do args+=(-r "$r"); done

# Copie cohérente de la base, même pendant que l'app écrit, puis archive avec les fichiers joints et les
# clés (auth.json : mot de passe haché ; two-factor.json : 2FA ; secret.key : clé des secrets de Réglages).
# Chiffrée avant de toucher le disque du VPS.
step="copie et chiffrement"
docker compose exec -T cairn sh -c '
  set -e
  tmp="backup-$$.db"
  cd /app
  trap "rm -f /data/$tmp" EXIT
  node -e "const db = require(\"better-sqlite3\")(\"/data/cairn.db\", { readonly: true }); db.backup(process.argv[1]).then(() => db.close())" "/data/$tmp"
  cd /data
  mkdir -p files
  tar -czf - --transform "s|^$tmp\$|backup.db|" "$tmp" files $(ls auth.json two-factor.json secret.key 2>/dev/null)
' | age "${args[@]}" > "$dest/$name.partial"

step="contrôle de l'archive"
[ -s "$dest/$name.partial" ]
mv "$dest/$name.partial" "$dest/$name"
bytes="$(wc -c < "$dest/$name" | tr -d ' ')"

# Les sauvegardes d'avant le chiffrement (cairn-*.tar.gz, en clair) ne sont pas supprimées d'office.
if ls "$dest"/cairn-*.tar.gz >/dev/null 2>&1; then
  echo "Attention : d'anciennes sauvegardes NON chiffrées sont encore dans $dest (cairn-*.tar.gz). Supprime-les quand tu as vérifié les nouvelles." >&2
fi

step="nettoyage local"
find "$dest" -maxdepth 1 -name 'cairn-*.tar.gz.age' -mtime +"$keep_days" -delete

if [ -n "$remote" ]; then
  step="copie hors du VPS (rclone vers $remote)"
  command -v rclone >/dev/null
  rclone copyto "$dest/$name" "${remote%/}/$name"
  step="nettoyage de $remote"
  rclone delete "${remote%/}" --min-age "${keep_days}d" --include 'cairn-*.tar.gz.age'
  offsite=true
fi

trap - ERR
report "$(printf '{"ok":true,"file":"%s","bytes":%s,"offsite":%s}' "$name" "$bytes" "$offsite")"
echo "Sauvegarde : $dest/$name ($bytes octets)$([ "$offsite" = true ] && echo ", copiée vers $remote")"
