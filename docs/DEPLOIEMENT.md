# Mettre Cairn en ligne sur le VPS

À la fin de ce guide : **https://cairn.antoinequarroz.ch**, protégé par un mot de passe.

Ce guide a été déroulé sur `antoine-vps` le 17 novembre 2026. Sur ce VPS, un seul Caddy sert tous les sites (`antoinequarroz-caddy`, du projet `~/antoinequarroz-vitrine`) et joint les apps par leur nom de conteneur, sur le réseau Docker `antoinequarroz-vitrine_appnet`. Cairn s'y branche comme Alfred et Zedline.

## 0. Prérequis

- Docker et le plugin compose (`docker compose version`).
- Le Caddy partagé `antoinequarroz-caddy` tient les ports 80 et 443, Cairn passe par lui. Sur un serveur sans ce Caddy, voir l'annexe.

## 1. DNS

Un enregistrement **A** `cairn` qui pointe vers l'IP du VPS. Pour vérifier : `dig +short cairn.antoinequarroz.ch`.

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

Le premier build prend quelques minutes sur le VPS. Pour vérifier que Caddy voit Cairn :

```bash
docker exec antoinequarroz-caddy wget -qSO /dev/null http://cairn:3000/login
```

La première ligne doit dire `HTTP/1.1 200 OK`.

## 3. Brancher le Caddy partagé

La configuration réellement lue par Caddy n'est **pas** le `Caddyfile` du dépôt vitrine, mais `~/.config/antoinequarroz-vitrine/runtime/Caddyfile` (monté par `compose.runtime.yml`, il survit aux déploiements de la vitrine). Sauvegarde-le, puis ajoute le bloc à la fin avec `cat >>`, pour garder le même fichier (c'est un montage, un éditeur qui le remplace casserait le lien) :

```bash
F=~/.config/antoinequarroz-vitrine/runtime/Caddyfile
cp -p "$F" "$F.bak-$(date +%F)-cairn"
cat >> "$F" <<'EOF'

cairn.antoinequarroz.ch {
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
EOF
docker exec antoinequarroz-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec antoinequarroz-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Le certificat HTTPS arrive en moins d'une minute, **à condition que le DNS de l'étape 1 réponde déjà**. Sinon, recharge Caddy une fois le DNS en place.

Si Caddy répond « 502 » : Cairn n'est pas sur le réseau `antoinequarroz-vitrine_appnet`. Vérifie avec `docker network inspect antoinequarroz-vitrine_appnet | grep -i cairn`, puis relance `docker compose up -d` côté Cairn.

## 4. Premier lancement

1. Ouvre https://cairn.antoinequarroz.ch et connecte-toi avec `APP_PASSWORD`.
2. Dans **Réglages**, change le mot de passe si tu veux.
3. Dans **Coffre**, crée le coffre avec un **mot de passe maître différent**. Note-le dans un endroit sûr : il ne peut pas être récupéré.
4. Sur Mac : Safari, Fichier, « Ajouter au Dock ». Sur iPhone : Partager, « Sur l'écran d'accueil ».

## 5. Sauvegardes

```bash
~/cairn/deploy/backup.sh                 # écrit dans ~/cairn-backups, garde les 14 dernières
```

Chaque nuit à 3 h, avec cron (`crontab -e`) :

```cron
0 3 * * * $HOME/cairn/deploy/backup.sh >> $HOME/cairn-backups.log 2>&1
```

Copie ensuite ce dossier **hors du VPS** (rsync vers ton Mac, ou un stockage objet). L'archive contient la base (`backup.db`), les fichiers joints et `auth.json`. Le coffre y est chiffré, les notes normales non.

Pour restaurer : arrête Cairn, décompresse l'archive dans le volume `cairn-data` en renommant `backup.db` en `cairn.db`, relance.

## 6. Mettre à jour

```bash
cd ~/cairn && git pull
cd deploy && docker compose up -d --build
```

Les données sont dans le volume Docker `cairn-data`, elles ne bougent pas.

## Annexe : serveur sans Caddy partagé

Sans `docker-compose.override.yml`, Cairn écoute sur `172.17.0.1:3020` (le pont Docker, réglable avec `CAIRN_BIND` et `CAIRN_PORT` dans `deploy/.env`), pour un proxy installé à côté. Sur un serveur vide, Cairn apporte son propre Caddy :

```bash
cd ~/cairn/deploy
docker compose --profile caddy up -d --build
```

Le domaine se règle dans `deploy/.env` (`CAIRN_DOMAIN`).
