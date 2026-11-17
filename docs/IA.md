# L'IA dans Cairn

## Ce que fait le bouton « IA »

Dans une note, le bouton **IA** (à côté de « Joindre ») propose :

| Action | Ce qu'elle fait |
| --- | --- |
| Résumer | Les points clés, sans rien inventer |
| Améliorer la rédaction | Plus clair et plus fluide, même sens, même ton |
| Corriger l'orthographe | Orthographe, grammaire, ponctuation, et rien d'autre |
| Continuer d'écrire | La suite du texte, à partir du curseur |
| Traduire | En français, anglais, allemand, italien ou espagnol |
| Consigne libre | Ce que tu écris : « fais-en une liste de tâches », « écris un plan pour… » |

L'action porte sur **le texte sélectionné**, ou sur **toute la note** si rien n'est sélectionné. « Continuer » prend toujours le texte avant le curseur.

La réponse ne va pas directement dans la note. Elle s'écrit dans un panneau sous la note, au fil de l'eau (**Arrêter** la coupe), puis tu choisis :

- **Remplacer la sélection** (ou **Remplacer la note** : pendant quelques secondes, la notification propose **Annuler** pour retrouver l'ancien texte),
- **Insérer en dessous** (pour « Continuer » : **Insérer à la suite**),
- **Copier**,
- **Fermer**, et rien ne change.

Si tu as modifié la note pendant que l'IA écrivait, Cairn retrouve le passage d'origine. S'il n'existe plus, il te le dit plutôt que d'écraser autre chose.

## Brancher une IA

Le plus simple : **Réglages > Intelligence artificielle**, dans l'app. Tu y connectes un abonnement ou une clé, tu choisis le fournisseur et le modèle, et le bouton **Tester** vérifie que ça répond (avec une phrase fixe : aucune note n'est envoyée). Les clés y sont gardées chiffrées sur le serveur et ne reviennent jamais dans le navigateur.

Ce qui est saisi dans Réglages passe avant le `.env`. Un champ laissé vide prend la valeur du `.env`, qui reste donc un repli valable (voir plus bas).

### Avec ton abonnement Claude (Pro ou Max)

Cairn passe par **Claude Code**, l'outil officiel d'Anthropic, installé dans l'image Docker de Cairn.

1. Sur ton Mac (où Claude Code est installé et connecté à ton abonnement) :

   ```bash
   claude setup-token
   ```

   Il ouvre le navigateur pour te connecter, puis affiche un jeton `sk-ant-oat01-…`, valable un an.
2. Dans Cairn, **Réglages > IA > Claude (abonnement)** : colle le jeton, enregistre, puis **Tester**.
3. Choisis **Claude (abonnement)** comme fournisseur utilisé (ou laisse « Automatique » s'il est le seul branché).

Modèle par défaut : `sonnet`, rapide et économe sur tes limites d'usage. `opus` ou `haiku` se choisissent dans le même écran. C'est ton abonnement, pour ton usage : les réponses comptent dans les limites de ton forfait, comme dans Claude Code.

### Avec ton abonnement ChatGPT (Codex)

Cairn passe par **Codex**, l'outil officiel d'OpenAI, lui aussi dans l'image Docker.

1. Sur ton Mac, connecte Codex en gardant la connexion dans un fichier (par défaut, il peut la ranger dans le trousseau macOS) :

   ```bash
   codex -c cli_auth_credentials_store=file login
   cat ~/.codex/auth.json | pbcopy
   ```

2. Dans Cairn, **Réglages > IA > Codex (abonnement ChatGPT)** : colle tout le contenu, enregistre, puis **Tester**.

Codex renouvelle sa connexion de lui-même : Cairn garde chaque nouvelle version, chiffrée. Le fichier n'existe sur le disque du serveur que pendant une réponse. Codex écrit sa réponse d'un bloc à la fin, au lieu de mot à mot comme les autres.

Si l'écran affiche « l'outil n'est pas installé », l'image Docker date d'avant ce module : reconstruis-la (`cd deploy && docker compose up -d --build`). Pour une image sans ces outils : `docker compose build --build-arg AI_TOOLS=`.

### Avec une clé d'API

Dans le même écran : **Claude (clé d'API)** pour une clé de console.anthropic.com, **OpenAI (clé d'API)** pour une clé OpenAI ou un serveur compatible (Ollama, LM Studio, OpenRouter, avec son adresse). Facturées à l'usage, à part de tout abonnement.

### La clé qui chiffre les réglages

Les clés saisies dans Réglages sont chiffrées avec `CAIRN_SECRET` si tu l'as mis dans le `.env` (recommandé, `openssl rand -hex 32`), sinon avec `data/secret.key`, créé tout seul. Si cette clé change ou se perd, Réglages affiche « Clé illisible » : il suffit de recoller la clé d'IA.

## Par le fichier .env (repli)

Tout ce qui précède peut aussi se régler dans le `.env` de Cairn (le même fichier que `APP_PASSWORD`), comme avant. Après un changement : `cd deploy && docker compose up -d`. Ce que Réglages contient passe avant.

### Hermes, comme Metricove

Hermes tourne déjà sur le VPS, avec le modèle que tu lui as donné. Il se règle aussi dans Réglages > IA (adresse et clé).

Si Hermes sert déjà Metricove, son API est activée. Sinon, dans `~/.hermes/.env` sur le VPS :

```env
API_SERVER_ENABLED=true
API_SERVER_KEY=<openssl rand -hex 32>
# Écoute aussi sur le réseau Docker, pour que le conteneur Cairn puisse joindre Hermes
API_SERVER_HOST=0.0.0.0
```

Relance Hermes (`hermes gateway`, port **8642** par défaut), puis ferme ce port à l'extérieur sans le fermer à Docker :

```bash
# Laisse passer les conteneurs Docker (dont Cairn), puis ferme le port au reste
sudo ufw insert 1 allow from 172.16.0.0/12 to any port 8642 proto tcp
sudo ufw deny 8642
```

L'ordre compte : ufw s'arrête à la première règle qui correspond, et un `deny 8642` seul bloquerait aussi Cairn, qui arrive par le réseau Docker. `insert 1` place l'autorisation tout en haut, même si un `deny 8642` existe déjà (posé pour Metricove, par exemple). `172.16.0.0/12` couvre le réseau par défaut de Docker et ceux de `docker compose`. Si tu as donné d'autres plages d'adresses à Docker, mets la tienne : `docker network inspect <réseau>` l'affiche.

Pour vérifier Hermes seul, depuis le VPS :

```bash
curl http://127.0.0.1:8642/v1/chat/completions \
  -H "Authorization: Bearer <API_SERVER_KEY>" -H "Content-Type: application/json" \
  -d '{"model":"hermes-agent","messages":[{"role":"user","content":"Bonjour"}]}'
```

Puis, dans le `.env` de Cairn :

```env
HERMES_URL=http://host.docker.internal:8642
HERMES_API_KEY=<la même clé que API_SERVER_KEY>
```

Le `docker-compose.yml` de Cairn sait déjà joindre le VPS par `host.docker.internal`. Cairn appelle `POST /v1/chat/completions` avec le modèle `hermes-agent` (modifiable avec `HERMES_MODEL`) et accepte jusqu'à 150 secondes de silence de la part de Hermes, le temps qu'il se serve de ses outils s'il en a besoin. Ce n'est pas une limite sur la durée de la réponse : tant que du texte arrive, Cairn attend la fin.

`HERMES_URL` ne doit pas contenir d'identifiants (`http://utilisateur:motdepasse@…`) : Cairn refuse une telle adresse. La clé va dans `HERMES_API_KEY`. Pareil pour `OPENAI_BASE_URL`.

### Une clé d'API Anthropic (Claude)

Crée une clé sur [console.anthropic.com](https://console.anthropic.com) (facturée à l'usage, à part de tout abonnement) :

```env
ANTHROPIC_API_KEY=<ta clé>
# Facultatif. Par défaut : claude-opus-5-5
ANTHROPIC_MODEL=
```

Pour payer moins cher, `claude-sonnet-5-5` ou `claude-haiku-5-5` suffisent largement à corriger et à résumer.

Avec les modèles récents, Cairn active le repli proposé par Anthropic : si le modèle refuse une demande pour une raison de sécurité, l'API la repasse à un autre modèle Claude, dans la même réponse.

### Une clé d'API OpenAI (ou un serveur compatible)

```env
OPENAI_API_KEY=<ta clé>
# Facultatif. Par défaut : gpt-5.1
OPENAI_MODEL=
# Facultatif. Par défaut : https://api.openai.com/v1
OPENAI_BASE_URL=
```

`OPENAI_BASE_URL` sert aussi à brancher tout serveur qui parle le même langage : Ollama, LM Studio, OpenRouter. Pour un Ollama installé sur le VPS : `OPENAI_BASE_URL=http://host.docker.internal:11434/v1`, `OPENAI_MODEL=<le modèle>` et une clé quelconque.

### Lequel est utilisé ?

Celui choisi dans **Réglages > IA**. Sinon `AI_PROVIDER` dans le `.env` (`hermes`, `anthropic`, `openai`, `claude-code` ou `codex`). Sinon, en automatique, le premier branché dans l'ordre **Hermes, Anthropic, OpenAI, Claude (abonnement), Codex**.

Abonnements par le `.env`, si tu préfères : `CLAUDE_CODE_OAUTH_TOKEN=<jeton de claude setup-token>` (et `CLAUDE_CODE_MODEL`), ou `CODEX_AUTH_JSON=<contenu de auth.json>` (et `CODEX_MODEL`). Un Codex réglé par le `.env` ne garde pas sa connexion renouvelée : préfère Réglages.

Le menu du bouton rappelle en bas avec qui il parle (« Avec Hermes »).

## Claude Code contre l'API de Cairn

Autre usage de ton abonnement, sans rien brancher : Claude Code, sur ton Mac, lit et écrit tes notes avec `API_TOKEN`.

```bash
curl -H "Authorization: Bearer $API_TOKEN" https://cairn.antoinequarroz.ch/api/notes
```

Tu peux alors lui demander « résume ma note sur X et range le résumé dans une nouvelle note ». Les routes sont dans le [README](../README.md). `API_TOKEN` n'ouvre ni le coffre ni les réglages.

## Ce qui est envoyé

Quand tu choisis une action, et seulement à ce moment-là, Cairn envoie au fournisseur :

- le texte sélectionné, ou la note si rien n'est sélectionné (pour « Continuer » : le texte avant le curseur), jusqu'à 60 000 caractères ;
- le titre de la note ;
- ta consigne, pour « Consigne libre » (2 000 caractères au plus) ;
- les instructions de Cairn pour l'IA (répondre en Markdown, sans commentaire autour).

Rien d'autre : ni les autres notes, ni les fichiers joints, ni le coffre.

**Jamais les notes chiffrées.** Sur une note avec le cadenas, l'IA est désactivée, même quand la note est déverrouillée : s'en servir enverrait le texte déchiffré au serveur, puis au fournisseur. Le bouton l'explique, et le code refuse d'envoyer la demande. Pour une note sensible, garde le cadenas et écris sans IA.

Les clés d'API et les jetons restent sur le serveur : le navigateur ne les voit jamais. Avec un abonnement, Claude Code et Codex tournent sans aucun outil (ils ne peuvent ni lire de fichiers ni lancer de commandes) et ne reçoivent que leur propre jeton.

Le contenu d'une note et son titre sont présentés à l'IA comme un texte à travailler, pas comme des ordres. Ils sont placés entre des balises au nom tiré au hasard à chaque demande, qu'un texte collé ne peut ni deviner ni refermer. Si tu colles une page web qui contient « ignore tes instructions… », l'IA est censée ne pas obéir. C'est une précaution, pas une garantie : relis avant d'insérer. Avec Hermes, qui a des outils, la vraie barrière reste ce que tu as autorisé à l'agent.

Dans le panneau, la réponse ne charge rien depuis un autre site : une image ou une vidéo distante y apparaît comme un simple lien (une adresse d'image peut servir à faire sortir du texte). Seuls tes fichiers joints s'affichent. Une fois la réponse insérée, l'aperçu de la note montre les images comme pour n'importe quelle note : si la réponse contient un lien d'image que tu n'attendais pas, ne l'insère pas.

Plus de détails dans [SECURITE.md](SECURITE.md).

## Vérifier que ça marche

1. **Dans l'app** : ouvre une note, clique sur **IA**. Le menu doit lister les actions et, en bas, « Avec Hermes » (ou Claude, ou OpenAI). S'il affiche encore l'explication, la configuration n'a pas été lue : vérifie le `.env` et relance le conteneur.

2. **En ligne de commande**, depuis n'importe où :

   ```bash
   # Une IA est-elle branchée ?
   curl -H "Authorization: Bearer $API_TOKEN" https://cairn.antoinequarroz.ch/api/ai
   # {"ready":true,"provider":"hermes","label":"Hermes"}

   # Une vraie demande : le texte doit arriver petit à petit (-N)
   curl -N -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
     -d '{"action":"summarize","text":"Cairn est une app de notes en Markdown, avec un coffre chiffré.","title":"Test"}' \
     https://cairn.antoinequarroz.ch/api/ai
   ```

   Les actions : `summarize`, `rewrite`, `fix`, `continue`, `translate` (avec `"language"`: `fr`, `en`, `de`, `it` ou `es`) et `custom` (avec `"instruction"`).

3. **Si ça ne répond pas**, le message d'erreur dit où ça coince :

   | Message | Cause probable |
   | --- | --- |
   | `Aucune IA n'est configurée` (503) | Rien dans Réglages ni dans le `.env`, ou le fournisseur choisi n'a pas sa clé |
   | `… n'est pas installé sur le serveur` (502) | Image Docker sans Claude Code ou Codex : reconstruis-la |
   | `Claude, abonnement … : <raison>` (502) | Jeton expiré ou révoqué (refais `claude setup-token`), ou limite d'usage de l'abonnement atteinte |
   | `Codex : <raison>` (502) | Connexion expirée (refais le `login` et recolle `auth.json`), ou limite d'usage atteinte |
   | `Hermes est injoignable` (502) | Hermes arrêté, mauvais port, `API_SERVER_HOST` n'écoute pas sur le réseau Docker, ou pare-feu (ufw) qui bloque le réseau Docker. Teste Hermes depuis le VPS avec la commande `curl` de la partie « Hermes » plus haut. Attention : ce `curl` passe par 127.0.0.1 et ne détecte pas un blocage du pare-feu. Vérifie avec `sudo ufw status numbered` que la règle `allow from 172.16.0.0/12` est au-dessus du `deny 8642` |
   | `L'adresse de … est invalide` (502) | `HERMES_URL` ou `OPENAI_BASE_URL` n'est pas une adresse `http(s)://` complète, ou contient des identifiants |
   | `… a répondu 401` (502) | Clé refusée par le fournisseur |
   | `… a répondu 404` (502) | Modèle inconnu, ou mauvaise adresse dans `OPENAI_BASE_URL` |
   | `… : <raison>` (502) | Le fournisseur a accepté la demande puis l'a refusée : quota, surcharge, refus du modèle. La raison est la sienne |
   | `… n'a pas répondu à temps` (502) | Aucune donnée du fournisseur pendant 150 s (Hermes) ou 120 s, avant le premier mot |
   | `… n'a rien répondu` (502) | Le fournisseur a terminé sans écrire un mot |

   Ces délais comptent le temps **sans aucune donnée** du fournisseur, pas la durée totale : une longue traduction peut s'écrire pendant plusieurs minutes.

   Une erreur qui survient au milieu d'une réponse coupe le texte dans l'app (« La réponse s'est interrompue avant la fin »), et le panneau ne propose alors que ce qui a été reçu. Sa raison est dans les journaux : `docker compose logs cairn | grep '\[ia\]'`. On y lit par exemple `a cessé de répondre` (silence de plus de 150 s ou 120 s en cours de route) ou `a coupé la réponse avant la fin` (connexion fermée sans le signal de fin).
