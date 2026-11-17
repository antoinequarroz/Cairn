# Cairn

Mes notes et mes secrets, chez moi. Un Notion sur mesure, auto-hébergé sur mon VPS : tout s'écrit en Markdown, avec un coffre chiffré pour les mots de passe et les clés SSH.

Cairn fait partie de la même suite que [Metricove](https://github.com/antoinequarroz/metricove_v2) (réseaux sociaux) et [Alfred](https://github.com/antoinequarroz/Alfred) (calendrier) : même stack, même design, une autre couleur.

En ligne sur **https://cairn.postmelo.ch** (voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)).

![Une note en Markdown](docs/img/notes.png)

## Ce qui marche aujourd'hui

- **Notes en Markdown** : écriture, aperçu ou les deux côte à côte, enregistrement automatique.
- **Recherche dans tout le texte** (⌘K) : notes et discussions avec l'IA, sans souci des accents, mots trouvés surlignés, limitée à un dossier si besoin. Une note chiffrée n'est cherchée que par son titre.
- **Import depuis Notion ou Markdown** (Réglages > Importer des notes) : l'export Notion « Markdown et CSV » tel quel, ou un dossier de fichiers `.md`. Les dossiers, les images, les liens entre pages et les bases (en tableaux) suivent.
- **Mise en forme sans connaître le Markdown** : barre d'outils (titres, gras, listes, tâches, tableaux, images…), raccourcis clavier et aide intégrée. Le menu `/` ajoute des encadrés, des blocs repliables, des commandes terminal, des liens vers d'autres notes, la date du jour et les actions de l'IA.
- **Images, vidéos, sons, fichiers** : glisse-les ou colle-les dans une note. Les vidéos se lisent dans la page.
- **Coffre** : identifiants, clés SSH et accès VPS, notes secrètes, générateur de mots de passe. Chiffré sur l'appareil, le serveur ne voit jamais le contenu.
- **Import et export du coffre** (Coffre > Importer / exporter) : depuis 1Password (`.1pux` ou CSV), Bitwarden (JSON ou CSV), NordPass (CSV), l'app Mots de passe d'Apple ou un navigateur (CSV). Les fichiers sont lus et chiffrés dans le navigateur. Export chiffré (sauvegarde réimportable) ou en clair (CSV, JSON), ce dernier après confirmation du mot de passe maître.
- **Cadenas par note** : une note sensible peut être chiffrée de bout en bout avec la clé du coffre.
- **Accès protégé** par mot de passe, modifiable dans Réglages, avec **double authentification** (code d'une app comme 1Password, codes de secours) en option ([docs/SECURITE.md](docs/SECURITE.md)).
- **Sauvegardes chiffrées** chaque nuit, copiées hors du VPS et gardées 30 jours, avec un script de restauration testé ([docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md), étape 5).
- **Installable** comme une app sur Mac (Safari, « Ajouter au Dock ») et sur iPhone (« Sur l'écran d'accueil »).
- **Apps Mac et iPhone natives** (SwiftUI) : notes, dossiers, recherche, coffre et notes à cadenas déchiffrés sur l'appareil, Face ID / Touch ID, remplissage automatique des mots de passe. Le code est dans [apps/apple](apps/apple/README.md).
- **Projets et dossiers** pour ranger notes et discussions, par glisser-déposer dans la barre latérale.
- **Discussions avec l'IA**, rangées dans les projets : consignes par projet, notes épinglées en contexte, réponses enregistrées sur le serveur même si l'onglet se ferme.
- **Interroger toutes ses notes** : « qu'est-ce que j'ai noté sur Caddy ? ». À chaque message, l'IA cherche dans toutes les notes (ou un seul dossier) avec l'index plein texte, répond à partir de ce qu'elle trouve et cite les notes en lien. Une note chiffrée n'est jamais cherchée ni envoyée.
- **API** pour Hermes et Claude Code, qui peuvent lire et écrire des notes.
- **Demander à l'IA** dans l'éditeur : résumer, améliorer, corriger, continuer, traduire, ou une consigne libre, sur la sélection ou sur toute la note. La réponse s'affiche à part, tu choisis ensuite de l'insérer ou non. Branché sur Hermes, l'API d'Anthropic ou celle d'OpenAI ([docs/IA.md](docs/IA.md)). Jamais sur une note chiffrée.

La suite (dossiers, questions sur toutes les notes, apps Mac et iOS natives) est dans [docs/ROADMAP.md](docs/ROADMAP.md).

## Lancer en local

```bash
pnpm install
pnpm dev
```

Puis ouvrir http://localhost:3000. Sans `APP_PASSWORD`, l'app est ouverte en local (et refuse de démarrer en production).

```bash
pnpm test    # tests du chiffrement et de l'IA (prompts, lecture des flux)
pnpm lint
pnpm build
```

## Configuration

Copier `.env.example` en `.env.local` (en local) ou `.env` (sur le VPS) :

| Variable | Rôle |
| --- | --- |
| `APP_PASSWORD` | Mot de passe de l'app. **Obligatoire en ligne.** Il se change ensuite dans **Réglages** : le nouveau est gardé (haché) dans `data/auth.json` et passe devant `APP_PASSWORD`. Mot de passe oublié : supprime ce fichier, `APP_PASSWORD` revient. |
| `API_TOKEN` | Jeton pour Hermes et Claude Code (`Authorization: Bearer …` sur `/api`). N'ouvre jamais le coffre ni les réglages. |
| `COMPTE_URL`, `COMPTE_CLIENT_SECRET`, `APP_URL` | Facultatif. Ajoute « Continuer avec mon Compte Postmelo » : on entre avec le [compte de la suite](https://github.com/antoinequarroz/postmelo-compte). Le secret est le même que `CAIRN_CLIENT_SECRET` côté compte, 32 caractères au moins ; `APP_URL` est l'adresse publique de Cairn. Seuls les administrateurs du compte entrent, sauf `COMPTE_MEMBERS=true`. Le mot de passe continue de marcher. Voir [docs/SECURITE.md](docs/SECURITE.md). |
| `CAIRN_SECRET` | Facultatif. Chiffre les clés d'IA saisies dans Réglages (sinon `data/secret.key`, créé tout seul). |
| `DATA_DIR` | Dossier de la base SQLite et des fichiers joints (`./data` par défaut). |
| `MAX_FILE_MB` | Taille maximale d'un fichier joint (500 Mo par défaut). |
| `HERMES_URL`, `HERMES_API_KEY`, `HERMES_MODEL` | Bouton « IA » avec Hermes, ton agent sur le VPS (modèle `hermes-agent` par défaut). |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Bouton « IA » avec l'API d'Anthropic (`claude-opus-5-5` par défaut). |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | Bouton « IA » avec l'API d'OpenAI ou un serveur compatible (`gpt-5.1` par défaut). |
| `AI_PROVIDER` | Impose `hermes`, `anthropic` ou `openai`. Sans lui : le premier configuré, dans cet ordre. |

Un seul fournisseur d'IA suffit, et aucun n'est obligatoire. Tout cela se règle aussi dans l'app, **Réglages > IA**, qui passe avant le `.env`. Le détail est dans [docs/IA.md](docs/IA.md).

Le **mot de passe maître du coffre** n'est pas une variable : il se choisit dans l'app, n'est jamais envoyé au serveur, et ne peut pas être récupéré s'il est perdu.

## API (pour Hermes et Claude Code)

| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | `/api/notes` | Lister les notes (titre, extrait, date) |
| POST | `/api/notes` | Créer une note (`title`, `content` en Markdown, `folderId` facultatif) |
| GET | `/api/notes/:id` | Lire une note |
| PATCH | `/api/notes/:id` | Modifier une note (`folderId: null` la sort de son dossier ; avec `ifUpdatedAt`, refuse en 409 si elle a changé entre-temps) |
| DELETE | `/api/notes/:id` | Supprimer une note |
| POST | `/api/files` | Commencer l'envoi d'un fichier (`name`, `mime`, `size`) |
| PUT | `/api/uploads/:id?offset=N` | Envoyer un morceau du fichier (8 Mo au plus) |
| GET | `/api/files/:id` | Télécharger un fichier |
| POST | `/api/import` | Importer un zip envoyé avec `/api/files` (`fileId`, `folderId` facultatif) : export Notion ou dossier Markdown |
| POST | `/api/vault/items` | Ajouter au coffre un élément chiffré (`data`) ou un lot importé (`items`, 500 au plus). Tout ce qui n'est pas chiffré est refusé |
| GET | `/api/search?q=…&folder=…` | Chercher dans les notes et les discussions (meilleurs résultats d'abord, `folder` facultatif) |
| GET, POST | `/api/folders` | Lister les dossiers, en créer un (`name`, `parentId`, `instructions`) |
| PATCH, DELETE | `/api/folders/:id` | Renommer, déplacer, changer les consignes ; supprimer (le contenu remonte d'un niveau) |
| GET, POST | `/api/conversations` | Lister les discussions, en créer une (`folderId`, `title`, `contextNoteIds`) |
| GET, PATCH, DELETE | `/api/conversations/:id` | Lire une discussion et ses messages, la modifier, la supprimer |
| POST | `/api/conversations/:id/messages` | Envoyer un message (`content`). La réponse arrive en texte, au fil de l'eau, et reste enregistrée |
| POST | `/api/conversations/:id/stop` | Arrêter la réponse en cours |
| GET | `/api/ai` | Savoir si une IA est branchée, et laquelle |
| POST | `/api/ai` | Demander à l'IA (`action`, `text`, `title`, `instruction`, `language`). La réponse arrive en texte, au fil de l'eau |

```bash
curl -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Idée","content":"# Une idée\n\nÀ creuser."}' \
  https://cairn.postmelo.ch/api/notes
```

Les notes chiffrées de bout en bout sont renvoyées chiffrées : un script ne peut pas les lire.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) : comment c'est construit, et pourquoi
- [Sécurité](docs/SECURITE.md) : ce qui est chiffré, contre quoi, et les limites
- [Déploiement](docs/DEPLOIEMENT.md) : mise en ligne sur le VPS, sauvegardes
- [IA](docs/IA.md) : brancher Hermes, Anthropic ou OpenAI, et ce qui leur est envoyé
- [Roadmap](docs/ROADMAP.md) : les prochaines étapes

## Stack

Next.js 15, SQLite (better-sqlite3), Tailwind CSS 4, cmdk, Sonner, marked + DOMPurify, Web Crypto + Argon2id (hash-wasm). La même base que Metricove.
