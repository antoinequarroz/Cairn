# Mettre Cairn en ligne sur le VPS

À la fin de ce guide : **https://cairn.antoinequarroz.ch**, protégé par un mot de passe.

Ce guide n'a pas encore été déroulé sur le VPS : les commandes sont celles de Metricove, adaptées. Si une étape coince, c'est probablement la 3 (le lien avec le Caddy de Metricove).

## 0. Prérequis

- Docker et le plugin compose (`docker compose version`).
- Metricove déjà en ligne sur ce VPS : son Caddy tient les ports 80 et 443, Cairn passe par lui. Sinon, voir l'annexe.

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
cairn.antoinequarroz.ch {
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

## Annexe : VPS sans Metricove

Cairn apporte son propre Caddy :

```bash
cd ~/cairn/deploy
docker compose --profile caddy up -d --build
```

Le domaine se règle dans `deploy/.env` (`CAIRN_DOMAIN`).
