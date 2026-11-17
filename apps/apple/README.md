# Cairn pour Mac et iPhone

Une seule app SwiftUI pour le Mac et l'iPhone (et l'iPad), branchée sur le serveur Cairn par la même API que l'app web.

## Ce que fait cette première version

- **Connexion** au serveur (`cairn.antoinequarroz.ch`) avec le mot de passe de Cairn, puis le code de double authentification s'il est activé. La session est gardée dans le Trousseau : pas besoin de se reconnecter à chaque lancement. Elle tombe quand le mot de passe change sur le serveur, comme sur le web.
- **Dossiers et projets** dans la barre latérale, **liste des notes** du dossier choisi (avec celles des sous-dossiers).
- **Recherche plein texte** du serveur, mots trouvés surlignés.
- **Écrire** en Markdown, enregistrement automatique, ou **lire** la note mise en forme (titres, listes, tâches, citations, blocs de code avec bouton Copier, images).
- **Créer, déplacer, supprimer** une note (⌘N sur Mac, menu contextuel, balayage sur iPhone).
- **Conflits entre appareils** : si la note a changé ailleurs pendant que tu l'écrivais, rien n'est écrasé. L'app demande quelle version garder, ou range ta version dans une copie « (conflit) ».

Pas encore : les notes à cadenas et le coffre (il faut porter le déchiffrement Argon2id + AES-GCM en Swift), le hors ligne, le remplissage automatique des mots de passe. Voir [docs/ROADMAP.md](../../docs/ROADMAP.md), étape 5.

## Lancer l'app

Il faut un Mac avec **Xcode 16** ou plus récent.

1. Ouvrir `apps/apple/Cairn.xcodeproj`.
2. Cible **Cairn** > *Signing & Capabilities* : choisir ton équipe (*Team*). Un compte Apple gratuit suffit pour le Mac et ton propre iPhone (l'app expire au bout de 7 jours sur l'iPhone). Le compte Apple Developer payant sert pour TestFlight, et plus tard pour le remplissage automatique.
3. Choisir la destination **My Mac** ou ton iPhone, puis ⌘R.
4. Dans l'app : l'adresse du serveur, le mot de passe de Cairn, puis le code si la double authentification est activée.

En ligne de commande, sans signer :

```bash
cd apps/apple
xcodebuild -scheme Cairn -destination 'generic/platform=macOS' CODE_SIGNING_ALLOWED=NO build
xcodebuild -scheme Cairn -destination 'generic/platform=iOS Simulator' build
cd CairnKit && swift test
```

## Organisation

| Dossier | Contenu |
|---|---|
| `CairnKit/` | Tout ce qui ne dessine pas : client de l'API, modèles, Trousseau, découpage du Markdown. Paquet Swift testé à part (`swift test`). |
| `Cairn/` | L'app SwiftUI : connexion, barre latérale, liste, éditeur, lecture. Xcode prend tous les fichiers du dossier (pas de liste à tenir à jour dans le projet). |
| `Cairn.xcodeproj` | Une seule cible multiplateforme (iOS 17, macOS 14). Identifiant `ch.antoinequarroz.cairn`, bac à sable activé sur Mac (réseau sortant seulement). |

## Sécurité

- L'app se connecte comme le navigateur : mot de passe, code, puis cookie de session. Le jeton `API_TOKEN` (pour Hermes et les scripts) n'est jamais dans l'app.
- Le cookie de session est dans le Trousseau, réservé à cet appareil (`AfterFirstUnlockThisDeviceOnly`), jamais dans les préférences.
- HTTPS obligatoire.
- Une image d'une note hébergée sur Cairn est chargée avec la session ; le cookie n'est jamais envoyé à un autre site.
