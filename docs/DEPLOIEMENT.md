# Mettre Cairn en ligne sur le VPS

À la fin de ce guide : **https://cairn.postmelo.ch**, protégé par un mot de passe.

Ce guide n'a pas encore été déroulé sur le VPS : les commandes sont celles de Metricove, adaptées. Si une étape coince, c'est probablement la 3 (le lien avec le Caddy de Metricove).

## 0. Prérequis

- Docker et le plugin compose (`docker compose version`).
- Metricove déjà en ligne sur ce VPS : son Caddy tient les ports 80 et 443, Cairn passe par lui. Sinon, voir l'annexe.

## 1. DNS

Un enregistrement **A** `cairn` dans la zone `postmelo.ch` (Infomaniak) qui pointe vers l'IP du VPS. Pour vérifier : `dig +short cairn.postmelo.ch`.

## 2. Installer Cairn

```bash
git clone https://github.com/antoinequarroz/cairn ~/cairn
cd ~/cairn
cp .env.example .env
nano .env
```

Remplis :

```env
APP_PASSWORD=<un mot de passe long>
API_TOKEN=<openssl rand -hex 32>
```

Puis :

```bash
cd deploy
cp .env.example .env
docker compose up -d --build
```

Cairn écoute maintenant sur `172.17.0.1:3020` : joignable par les autres conteneurs du VPS, pas depuis Internet. Pour vérifier : `curl -I http://172.17.0.1:3020/login` doit répondre `200`.

## 3. Brancher le Caddy de Metricove

Dans `~/metricove/deploy/Caddyfile`, ajoute :

```caddy
cairn.postmelo.ch {
	encode zstd gzip
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy host.docker.internal:3020
}
```

Puis recharge Caddy :

```bash
cd ~/metricove/deploy
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Le certificat HTTPS arrive en moins d'une minute.

Si Caddy répond « 502 » : `host.docker.internal` ne correspond pas à `172.17.0.1` sur ce VPS. Cherche la bonne adresse avec `docker compose exec caddy getent hosts host.docker.internal`, mets-la dans `CAIRN_BIND` (`~/cairn/deploy/.env`), puis relance `docker compose up -d` côté Cairn.

## 4. Premier lancement

1. Ouvre https://cairn.postmelo.ch et connecte-toi avec `APP_PASSWORD`.
2. Dans **Réglages**, change le mot de passe si tu veux.
3. Dans **Coffre**, crée le coffre avec un **mot de passe maître différent**. Note-le dans un endroit sûr : il ne peut pas être récupéré.
4. Sur Mac : Safari, Fichier, « Ajouter au Dock ». Sur iPhone : Partager, « Sur l'écran d'accueil ».

## 5. Sauvegardes chiffrées

Chaque nuit, `deploy/backup.sh` fait une copie cohérente de la base, l'archive avec les fichiers joints et les clés du serveur (`auth.json`, `two-factor.json`, `secret.key`), la **chiffre avec [age](https://age-encryption.org)**, puis l'envoie **hors du VPS** avec rclone. Les sauvegardes de plus de 30 jours sont effacées, sur le VPS comme sur la destination. Le résultat s'affiche dans **Réglages > Sécurité** (« À vérifier » si la dernière a échoué ou a plus de 36 heures).

### Une seule fois : la clé de sauvegarde (sur ton Mac)

```bash
brew install age
age-keygen -o ~/cairn-backup-key.txt     # affiche « Public key: age1… »
```

- La **clé publique** (`age1…`) va sur le VPS : elle sert seulement à chiffrer.
- La **clé privée** (`cairn-backup-key.txt`) ne va **jamais** sur le VPS. Garde-la sur ton Mac et une copie ailleurs (clé USB, 1Password, papier). **Pas seulement dans le coffre de Cairn** : il faut pouvoir restaurer Cairn quand Cairn est perdu. Sans elle, les sauvegardes sont illisibles.

Ainsi, quelqu'un qui prend le VPS ou la destination ne peut lire aucune sauvegarde.

### Une seule fois : la destination hors du VPS

N'importe quelle destination [rclone](https://rclone.org/overview/) : une Storage Box Hetzner (SFTP), un bucket S3 ou Backblaze B2, ton Mac par SFTP…

```bash
sudo apt install age rclone
rclone config            # crée par exemple un « remote » nommé storagebox
rclone mkdir storagebox:cairn
```

### Réglages

Dans `~/cairn/deploy/.env` :

```env
CAIRN_BACKUP_RECIPIENTS=age1…            # la clé publique (plusieurs possibles, séparées par un espace)
CAIRN_BACKUP_REMOTE=storagebox:cairn     # vide : sauvegardes gardées sur le VPS seulement
CAIRN_BACKUP_KEEP_DAYS=30
```

Essaie une fois à la main, puis programme-la chaque nuit à 3 h (`crontab -e`) :

```bash
~/cairn/deploy/backup.sh
```

```cron
0 3 * * * $HOME/cairn/deploy/backup.sh >> $HOME/cairn-backups.log 2>&1
```

Les anciennes sauvegardes **non chiffrées** (`~/cairn-backups/cairn-*.tar.gz`, d'avant cette version) ne sont pas effacées d'office : supprime-les quand les nouvelles marchent.

### Restaurer

Sur le VPS, ou sur une machine vierge après les étapes 2 (sans `docker compose up`) et 3 :

```bash
rclone copy storagebox:cairn/cairn-2026-11-17_0300.tar.gz.age .
scp ~/cairn-backup-key.txt vps:/tmp/          # depuis le Mac, le temps de la restauration
cd ~/cairn/deploy
./restore.sh cairn-2026-11-17_0300.tar.gz.age -i /tmp/cairn-backup-key.txt --check   # vérifie sans rien toucher
./restore.sh cairn-2026-11-17_0300.tar.gz.age -i /tmp/cairn-backup-key.txt           # restaure
shred -u /tmp/cairn-backup-key.txt
```

`--check` déchiffre l'archive, vérifie l'intégrité de la base et compte les notes, éléments du coffre et fichiers. La restauration arrête Cairn, met les données actuelles de côté dans le volume (`/data/avant-restauration-<date>/`, à supprimer une fois vérifié), installe la sauvegarde et relance. On se connecte ensuite avec le mot de passe et la double authentification **d'alors**, et le coffre s'ouvre avec son mot de passe maître habituel.

Testé de bout en bout le 17.11.2026 : sauvegarde d'une installation avec une note et la double authentification, restauration dans une installation neuve (autre projet Docker, volume vide), note retrouvée, connexion avec un code TOTP puis un code de secours.

**Teste une restauration (`--check` suffit) une fois par trimestre.**

## 6. Mettre à jour

```bash
cd ~/cairn && git pull
cd deploy && docker compose up -d --build
```

Les données sont dans le volume Docker `cairn-data`, elles ne bougent pas.

## Annexe : VPS sans Metricove

Cairn apporte son propre Caddy :

```bash
cd ~/cairn/deploy
docker compose --profile caddy up -d --build
```

Le domaine se règle dans `deploy/.env` (`CAIRN_DOMAIN`).
