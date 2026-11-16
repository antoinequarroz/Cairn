# Architecture

## En une image

```
 Mac / iPhone / navigateur                       VPS (Docker)
┌──────────────────────────┐   HTTPS    ┌──────────────────────────────┐
│ App web (PWA installable)│ ─────────► │ Caddy (certificats)          │
│                          │            │   └─► Cairn (Next.js)        │
│ Chiffrement du coffre et │            │         ├─ SQLite  /data/cairn.db
│ des notes verrouillées   │            │         └─ Fichiers /data/files
│ (clé en mémoire)         │            │                              │
└──────────────────────────┘            │ Hermes, Claude Code ──► /api │
                                        └──────────────────────────────┘
```

Une seule app, une seule base, un seul conteneur. C'est volontairement la même forme que Metricove : un seul projet à comprendre, à sauvegarder et à mettre à jour.

## Choix

| Sujet | Choix | Pourquoi |
| --- | --- | --- |
| App | Next.js 15, React 19 | Même stack que Metricove : composants et habitudes réutilisables |
| Base | SQLite (better-sqlite3) | Un fichier, zéro service à administrer, largement suffisant pour une personne |
| Fichiers | Sur disque, dans `DATA_DIR/files` | Les vidéos n'ont rien à faire dans la base. Envoi par morceaux de 8 Mo |
| Format des notes | Markdown brut | Pas de format propriétaire : une note s'exporte telle quelle |
| Rendu Markdown | marked + DOMPurify | Le HTML produit est nettoyé : une note collée ne peut pas exécuter de script |
| Chiffrement | Web Crypto (AES-256-GCM) + Argon2id | Standard, présent dans tous les navigateurs, voir [SECURITE.md](SECURITE.md) |
| Design | Tokens de Metricove, accent indigo | Une suite cohérente. Metricove est orange, Cairn est indigo |
| Mise en ligne | Docker + Caddy | Comme Metricove, derrière le même Caddy |

## Les trois niveaux de protection

1. **Notes normales** : lisibles par le serveur. C'est ce qui permet la recherche, l'API et bientôt l'IA. Protégées par le mot de passe de l'app et HTTPS.
2. **Notes verrouillées** (cadenas) : chiffrées dans le navigateur avec la clé du coffre. Le serveur ne garde qu'un bloc illisible. Le titre reste visible, pour s'y retrouver.
3. **Coffre** : chaque élément (nom compris) est chiffré dans le navigateur. Le serveur sait seulement combien il y en a.

## Organisation du code

```
src/
  app/
    (app)/            pages : notes, coffre, réglages
    api/              routes : auth, notes, files, uploads, vault, settings
    login/            page de connexion
    globals.css       tokens de design et rendu du Markdown
  components/         coque de l'app, éditeur, coffre, recherche
  lib/
    crypto.ts         chiffrement du coffre (navigateur) + tests
    vault-store.ts    clé du coffre en mémoire, verrouillage automatique
    markdown.ts       Markdown vers HTML sûr
    upload.ts         envoi de fichiers par morceaux
  server/
    db.ts             SQLite : schéma et requêtes
    password.ts       mot de passe de l'app (scrypt)
    session.ts        qui a le droit d'entrer
  middleware.ts       protège tout sauf la connexion
deploy/               Docker, Caddy, sauvegarde
```

## Base de données

| Table | Contenu |
| --- | --- |
| `notes` | Titre, contenu (Markdown, ou bloc chiffré si `encrypted = 1`), dates |
| `vault_meta` | Une ligne : paramètres Argon2id, sel, clé du coffre chiffrée par le mot de passe maître |
| `vault_items` | Un bloc chiffré par élément |
| `files` | Nom, type et taille de chaque fichier joint |
| `uploads` | Envois de fichiers en cours |

## Web, Mac, iOS

Même démarche que celle retenue pour Alfred : **le web d'abord**, installable comme une app (PWA) sur Mac et iPhone, puis des apps natives seulement là où elles apportent quelque chose.

| Plateforme | Maintenant | Ensuite |
| --- | --- | --- |
| Web | App complète | |
| Mac | PWA depuis Safari (« Ajouter au Dock ») | **Tauri** : raccourci global, agent SSH qui sert les clés du coffre sans les écrire sur le disque |
| iPhone | PWA (« Sur l'écran d'accueil ») | **Capacitor** ou SwiftUI : Face ID pour ouvrir le coffre, remplissage automatique des mots de passe, partage vers Cairn |

Les apps natives parleront à la même API. Le chiffrement reste le même format (`v1.<iv>.<chiffré>`), documenté dans [SECURITE.md](SECURITE.md), pour être relu à l'identique en Swift ou en Rust.

## IA

Deux voies, compatibles entre elles :

- **Dès maintenant, par l'API** : Claude Code (avec ton abonnement) ou Hermes lisent et écrivent des notes avec `API_TOKEN`. Rien à installer dans Cairn.
- **Dans l'éditeur (roadmap)** : un bouton « Demander à l'IA » (résumer, réécrire, continuer, créer un fichier). Cairn appellera Hermes sur le VPS, comme Metricove le fait pour les légendes, ou directement l'API d'Anthropic ou d'OpenAI avec une clé.

À savoir : un abonnement Claude ou ChatGPT s'utilise à travers leurs outils (Claude Code, Codex), pas comme une clé d'API dans une app. C'est pour cela que la première voie passe par Claude Code ou Hermes.

L'IA ne voit jamais le coffre ni les notes verrouillées : le serveur ne peut pas les lire.
