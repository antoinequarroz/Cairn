# Architecture

## En une image

```
 Mac / iPhone / navigateur                       VPS (Docker)
┌──────────────────────────┐   HTTPS    ┌──────────────────────────────┐
│ App web (PWA installable)│ ─────────► │ Caddy (certificats)          │
│                          │            │   └─► Cairn (Next.js)        │
│ Chiffrement du coffre et │            │         ├─ SQLite  /data/cairn.db
│ des notes verrouillées   │            │         ├─ Fichiers /data/files
│ (clé en mémoire)         │            │         └─► IA : Hermes (VPS),
│                          │            │             Anthropic ou OpenAI
│                          │            │                              │
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
| IA | Appels HTTP directs, sans SDK | Trois fournisseurs, une seule forme (un flux de texte). Rien à installer de plus |

## Les trois niveaux de protection

1. **Notes normales** : lisibles par le serveur. C'est ce qui permet la recherche, l'API et l'IA. Protégées par le mot de passe de l'app et HTTPS.
2. **Notes verrouillées** (cadenas) : chiffrées dans le navigateur avec la clé du coffre. Le serveur ne garde qu'un bloc illisible. Le titre reste visible, pour s'y retrouver.
3. **Coffre** : chaque élément (nom compris) est chiffré dans le navigateur. Le serveur sait seulement combien il y en a.

## Organisation du code

```
src/
  app/
    (app)/            pages : notes, coffre, réglages
    api/              routes : auth, notes, files, uploads, vault, settings, ai
    login/            page de connexion
    globals.css       tokens de design et rendu du Markdown
  components/         coque de l'app, éditeur, coffre, recherche
    ai-assistant.tsx  bouton « IA », son menu et le panneau de réponse
  lib/
    crypto.ts         chiffrement du coffre (navigateur) + tests
    vault-store.ts    clé du coffre en mémoire, verrouillage automatique
    markdown.ts       Markdown vers HTML sûr
    upload.ts         envoi de fichiers par morceaux
    ai.ts             IA sans secret ni réseau : validation, prompts, choix du
                      fournisseur, lecture des flux SSE, insertion + tests
  server/
    db.ts             SQLite : schéma et requêtes
    password.ts       mot de passe de l'app (scrypt)
    session.ts        qui a le droit d'entrer
    ai.ts             appel du fournisseur d'IA (clés, délais, erreurs)
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

- **Par l'API** : Claude Code (avec ton abonnement) ou Hermes lisent et écrivent des notes avec `API_TOKEN`. Rien à installer dans Cairn.
- **Dans l'éditeur** : le bouton « IA » (résumer, améliorer, corriger, continuer, traduire, consigne libre). Cairn appelle Hermes sur le VPS, comme Metricove le fait pour les légendes, ou directement l'API d'Anthropic ou d'OpenAI avec une clé. Tout se règle dans Réglages > IA (clés chiffrées, `src/server/ai-settings.ts`), le `.env` restant le repli. Le mode d'emploi est dans [IA.md](IA.md).

Le chemin d'une demande :

```
éditeur ── POST /api/ai {action, text, title} ──► src/server/ai.ts ──► fournisseur
   ▲                                                    │                (flux SSE)
   └────────── texte brut, au fil de l'eau ◄────────────┘
```

- **Le navigateur choisit une action, jamais un prompt.** Le prompt est construit sur le serveur (`buildPrompt` dans `src/lib/ai.ts`). La note et son titre y sont donnés comme un texte à travailler, entre des balises au nom aléatoire (nommées dans le prompt système, impossibles à refermer depuis la note), avec la consigne de ne pas obéir à ce qu'ils contiennent : une note collée depuis le web ne doit pas pouvoir piloter l'IA. Pour la même raison, le panneau affiche la réponse sans rien charger d'un autre site (`renderMarkdown(…, { remoteMedia: false })`).
- **Un seul format vers le navigateur.** Hermes et OpenAI parlent le même langage (`/v1/chat/completions`), Anthropic le sien (`/v1/messages`). Le serveur lit leur flux SSE et ne renvoie que du texte : le navigateur n'a rien à savoir du fournisseur, et les clés ne quittent pas le serveur.
- **Le choix du fournisseur** se fait dans `.env` : `AI_PROVIDER` s'il est défini, sinon le premier configuré dans l'ordre Hermes, Anthropic, OpenAI.
- **La réponse ne touche pas la note toute seule.** Elle s'affiche dans un panneau, puis passe par le même chemin que la frappe (`change()` dans l'éditeur) quand tu choisis « Remplacer » ou « Insérer » : l'enregistrement automatique fait le reste.
- **Délais** : 150 secondes de silence au plus pour Hermes (un agent peut se servir de ses outils avant de répondre), 120 pour les deux autres. C'est le temps sans aucune donnée du fournisseur, pas la durée totale de la réponse.
- **Les erreurs avant le premier mot sont de vraies erreurs.** Les fournisseurs répondent 200 puis annoncent une surcharge, un quota ou un refus dans leur flux : le serveur attend donc le premier texte avant de répondre, et renvoie sinon un 502 avec la raison. Après, il ne peut plus que couper le flux (raison dans les journaux). Une connexion fermée sans le signal de fin du fournisseur compte comme une coupure, pas comme une réponse complète.

À savoir : un abonnement Claude ou ChatGPT s'utilise à travers leurs outils (Claude Code, Codex), pas comme une clé d'API dans une app. C'est pour cela que la première voie passe par Claude Code ou Hermes.

L'IA ne voit jamais le coffre ni les notes verrouillées : le serveur ne peut pas les lire, et l'éditeur refuse d'envoyer à l'IA le texte d'une note chiffrée, même déverrouillée.
