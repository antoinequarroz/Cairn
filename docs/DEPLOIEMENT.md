# Mettre Cairn en ligne sur le VPS

À la fin de ce guide : **https://cairn.postmelo.ch**, protégé par un mot de passe.

Ce guide a été déroulé sur `antoine-vps` le 17 novembre 2026 (d'abord sur cairn.antoinequarroz.ch, puis passé sur cairn.postmelo.ch le même jour ; l'ancienne adresse redirige en 301). Sur ce VPS, un seul Caddy sert tous les sites (`antoinequarroz-caddy`, du projet `~/antoinequarroz-vitrine`) et joint les apps par leur nom de conteneur, sur le réseau Docker `antoinequarroz-vitrine_appnet`. Cairn s'y branche comme Alfred et les autres apps de la suite.

> **Un seul build à la fois.** Le VPS n'a que 2 Go de RAM et héberge toute la suite (Lamio, Alfred, TickUp, la vitrine, Cairn). Avant un `docker compose up -d --build`, vérifie qu'aucun autre build ne tourne (`docker ps`, `top`). Le 17 novembre, plusieurs builds en même temps ont fait tomber la mémoire libre à 500 Mo et Caddy a renvoyé des 502.

## 0. Prérequis

- Docker et le plugin compose (`docker compose version`).
- Le Caddy partagé `antoinequarroz-caddy` tient les ports 80 et 443, Cairn passe par lui. Sur un serveur sans ce Caddy, voir l'annexe.

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

Puis, pour que Cairn rejoigne le réseau du Caddy partagé, crée `deploy/docker-compose.override.yml` (ignoré par git, lu tout seul par `docker compose`) :

```bash
cd deploy
cp .env.example .env
cat > docker-compose.override.yml <<'EOF'
services:
  cairn:
    ports: !reset []        # rien de publié sur l'hôte : seul Caddy joint Cairn
    networks:
      default:
      appnet:
        aliases: [cairn]
networks:
  appnet:
    external: true
    name: antoinequarroz-vitrine_appnet
EOF
docker compose up -d --build
```

Le premier build prend quelques minutes sur le VPS (un seul à la fois, voir plus haut). Pour vérifier que Caddy voit Cairn :

```bash
docker exec antoinequarroz-caddy wget -qSO /dev/null http://cairn:3000/login
```

La première ligne doit dire `HTTP/1.1 200 OK`.

Au premier démarrage, Cairn crée tout seul ses clés dans le volume : `session.key` (signe les cookies de session) et, au premier usage, `secret.key` (chiffre les clés d'IA et la double authentification).

## 3. Brancher le Caddy partagé

La configuration réellement lue par Caddy n'est **pas** le `Caddyfile` du dépôt vitrine, mais `~/.config/antoinequarroz-vitrine/runtime/Caddyfile` (monté par `compose.runtime.yml`, il survit aux déploiements de la vitrine). Sauvegarde-le, puis ajoute les blocs à la fin avec `cat >>`, pour garder le même fichier (c'est un montage : un éditeur qui le remplace casserait le lien) :

```bash
F=~/.config/antoinequarroz-vitrine/runtime/Caddyfile
cp -p "$F" "$F.bak-$(date +%F)-cairn"
cat >> "$F" <<'EOF'

cairn.postmelo.ch {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
	# Fichiers joints (vidéos) jusqu'à 500 Mo
	request_body {
		max_size 500MB
	}
	reverse_proxy cairn:3000
}

# Ancienne adresse : redirection permanente, chemin compris (/vault, /notes/…)
cairn.antoinequarroz.ch {
	redir https://cairn.postmelo.ch{uri} permanent
}
EOF
docker exec antoinequarroz-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec antoinequarroz-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Sur une installation neuve, le bloc de redirection est inutile : garde seulement le premier.

Le certificat HTTPS arrive en moins d'une minute, **à condition que le DNS de l'étape 1 réponde déjà**. Sinon, recharge Caddy une fois le DNS en place.

Ne mets pas de `Content-Security-Policy` dans Caddy : Cairn envoie la sienne (en production), et deux politiques s'additionneraient. Laisse aussi passer les en-têtes `Origin` et `Sec-Fetch-Site` tels quels (c'est le cas par défaut avec `reverse_proxy`) : Cairn s'en sert pour refuser les modifications venues d'un autre site, y compris des autres apps de `*.postmelo.ch`.

Si Caddy répond « 502 » : Cairn n'est pas sur le réseau `antoinequarroz-vitrine_appnet`, ou le VPS manque de mémoire (un build en cours ?). Vérifie avec `docker network inspect antoinequarroz-vitrine_appnet | grep -i cairn` et `free -m`, puis relance `docker compose up -d` côté Cairn.

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

Sur `antoine-vps`, c'est **Infomaniak Swiss Backup** (appareil « Cairn », stockage OpenStack Swift), branché le 17 novembre 2026 sous le remote rclone `swissbackup`. Les identifiants de l'appareil (URL, utilisateur, projet) sont dans Infomaniak : Swiss Backup, l'appareil Cairn, Gérer ; le mot de passe peut y être redéfini.

N'importe quelle autre destination [rclone](https://rclone.org/overview/) marche aussi : une Storage Box Hetzner (SFTP), un bucket S3 ou Backblaze B2, ton Mac par SFTP…

```bash
sudo apt install age rclone
rclone config            # type « swift » pour Swiss Backup, remote nommé swissbackup
rclone mkdir swissbackup:cairn
```

### Réglages

Dans `~/cairn/deploy/.env` :

```env
CAIRN_BACKUP_RECIPIENTS=age1…            # la clé publique (plusieurs possibles, séparées par un espace)
CAIRN_BACKUP_REMOTE=swissbackup:cairn    # vide : sauvegardes gardées sur le VPS seulement
CAIRN_BACKUP_KEEP_DAYS=30
```

Essaie une fois à la main, puis programme-la chaque nuit à 3 h (`crontab -e`) :

```bash
~/cairn/deploy/backup.sh
```

```cron
0 3 * * * $HOME/cairn/deploy/backup.sh >> $HOME/cairn-backups.log 2>&1
```

Les archives chiffrées restent aussi sur le VPS, dans `~/cairn-backups/` (30 jours). Les anciennes sauvegardes **non chiffrées** (`cairn-*.tar.gz`, d'avant le 17 novembre 2026) ne sont pas effacées d'office : supprime-les quand les nouvelles marchent (fait sur `antoine-vps` le 17 novembre).

### Restaurer

Sur le VPS, ou sur une machine vierge après les étapes 2 (sans `docker compose up`) et 3 :

```bash
rclone copy swissbackup:cairn/cairn-2026-11-17_0300.tar.gz.age .
scp ~/cairn-backup-key.txt antoine-vps:/tmp/          # depuis le Mac, le temps de la restauration
cd ~/cairn/deploy
./restore.sh cairn-2026-11-17_0300.tar.gz.age -i /tmp/cairn-backup-key.txt --check   # vérifie sans rien toucher
./restore.sh cairn-2026-11-17_0300.tar.gz.age -i /tmp/cairn-backup-key.txt           # restaure
shred -u /tmp/cairn-backup-key.txt
```

`--check` déchiffre l'archive, vérifie l'intégrité de la base et compte les notes, éléments du coffre et fichiers. La restauration arrête Cairn, met les données actuelles de côté dans le volume (`/data/avant-restauration-<date>/`, à supprimer une fois vérifié), installe la sauvegarde et relance. On se connecte ensuite avec le mot de passe et la double authentification **d'alors**, et le coffre s'ouvre avec son mot de passe maître habituel. `session.key` n'est pas dans la sauvegarde : Cairn en crée une nouvelle, donc tous les appareils (navigateur, Mac, iPhone) doivent se reconnecter.

Testé de bout en bout le 17.11.2026 : sauvegarde d'une installation avec une note et la double authentification, restauration dans une installation neuve (autre projet Docker, volume vide), note retrouvée, connexion avec un code TOTP puis un code de secours.

**Teste une restauration (`--check` suffit) une fois par trimestre.**

**Attention à `CAIRN_SECRET`** : s'il est défini dans `~/cairn/.env`, l'archive ne contient pas `secret.key` (`--check` affiche « secret.key : non »), et la clé qui chiffre les clés d'IA de Réglages n'est **que** dans ce `.env`. Garde une copie du `.env` hors du VPS (1Password, avec la clé de sauvegarde). Sans lui, une restauration ramène notes et coffre, mais il faut ressaisir les clés d'IA dans Réglages > IA.

### Exercice de restauration sur le Mac (sans toucher au VPS)

Pour le test trimestriel, sans arrêter Cairn ni lancer de build sur le VPS (2 Go de RAM) : la sauvegarde est lue **depuis la destination hors du VPS**, déchiffrée sur le Mac et restaurée dans une installation Docker jetable, puis tout est effacé. Il faut Docker Desktop et `age` sur le Mac.

```bash
W=$(mktemp -d) && chmod 700 $W && cd $W
F=$(ssh vps 'rclone lsf swissbackup:cairn | sort | tail -1')   # la plus récente
ssh vps "rclone cat swissbackup:cairn/$F" > $F                # rien n'est écrit sur le disque du VPS
ssh vps "sha256sum ~/cairn-backups/$F"; shasum -a 256 $F       # la copie distante = la copie locale

mkdir src && git -C ~/Lab/projets/Cairn archive origin/main | tar -x -C src   # le code déployé, pas ta copie de travail
cd src
printf 'APP_PASSWORD=test-%s\nCAIRN_BIND=127.0.0.1\nCAIRN_PORT=3921\n' "$(openssl rand -hex 8)" | tee .env > deploy/.env
cd deploy && export COMPOSE_PROJECT_NAME=cairn-restore-test       # projet Docker séparé, volume vide
docker compose build cairn
./restore.sh $W/$F -i ~/cairn-backup-key.txt --check
./restore.sh $W/$F -i ~/cairn-backup-key.txt --yes
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3921/login   # 200
docker compose exec -T cairn node -e 'const db=require("better-sqlite3")("/data/cairn.db",{readonly:true});console.log(db.pragma("integrity_check",{simple:true}), db.prepare("select count(*) n from notes").get().n, db.prepare("select count(*) n from vault_items where data like ?").get("v1.%").n)'
                                                                   # « ok <notes> <éléments du coffre chiffrés> »

docker compose down -v --rmi local && cd / && rm -rf $W            # efface volume, image et archive déchiffrée
```

Les éléments du coffre restent chiffrés (`v1.…`) : la sauvegarde ne contient ni le mot de passe maître ni la clé du coffre en clair (`vault_meta` ne garde que la clé enveloppée et les paramètres de dérivation). Pour aller plus loin, ouvre http://127.0.0.1:3921 avant le `down`, connecte-toi avec ton mot de passe et ta double authentification, et déverrouille le coffre.

Fait le 18.11.2026 avec `cairn-2026-11-18_0300.tar.gz.age` lue sur Infomaniak Swiss Backup : même empreinte SHA-256 que la copie du VPS, base intacte, 1 note, 91 éléments du coffre (tous chiffrés), 3 dossiers, 1 discussion, `auth.json` et `two-factor.json` présents, app relancée sur la base restaurée (page de connexion 200, API 401 sans session).

## 6. Mettre à jour

D'abord, vérifie qu'aucun autre build ne tourne sur le VPS (2 Go de RAM). Puis sauvegarde et reconstruis :

```bash
~/cairn/deploy/backup.sh
cd ~/cairn && git pull
cd deploy && docker compose up -d --build
```

Les données sont dans le volume Docker `cairn-data`, elles ne bougent pas. Après la mise à jour, vérifie que `https://cairn.postmelo.ch/login` répond `200` avec un en-tête `Content-Security-Policy`.

Si `session.key` est supprimée ou remplacée, toutes les sessions tombent et il faut se reconnecter partout. Pour déconnecter les autres appareils sans toucher au serveur : **Réglages > Sécurité > Déconnecter les autres appareils**.

## Annexe : serveur sans Caddy partagé

Sans `docker-compose.override.yml`, Cairn écoute sur `172.17.0.1:3020` (le pont Docker, réglable avec `CAIRN_BIND` et `CAIRN_PORT` dans `deploy/.env`), pour un proxy installé à côté. Sur un serveur vide, Cairn apporte son propre Caddy :

```bash
cd ~/cairn/deploy
docker compose --profile caddy up -d --build
```

Le domaine se règle dans `deploy/.env` (`CAIRN_DOMAIN`).
