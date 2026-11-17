# Cairn pour Mac et iPhone

Une seule app SwiftUI pour le Mac et l'iPhone (et l'iPad), branchée sur le serveur Cairn par la même API que l'app web.

## Ce que fait cette première version

- **Connexion** au serveur (`cairn.postmelo.ch`) avec le **Compte Postmelo** (« Continuer avec mon Compte Postmelo », quand le serveur l'a activé) ou le mot de passe de Cairn, puis le code de double authentification s'il est demandé. La session est gardée dans le Trousseau : pas besoin de se reconnecter à chaque lancement. Elle tombe quand le mot de passe change sur le serveur, comme sur le web.
- **Dossiers et projets** dans la barre latérale, **liste des notes** du dossier choisi (avec celles des sous-dossiers).
- **Recherche plein texte** du serveur, mots trouvés surlignés.
- **Écrire** en Markdown, enregistrement automatique, ou **lire** la note mise en forme (titres, listes, tâches, citations, blocs de code avec bouton Copier, images).
- **Créer, déplacer, supprimer** une note (⌘N sur Mac, menu contextuel, balayage sur iPhone).
- **Conflits entre appareils** : si la note a changé ailleurs pendant que tu l'écrivais, rien n'est écrasé. L'app demande quelle version garder, ou range ta version dans une copie « (conflit) ».

### Coffre, cadenas et remplissage automatique

- **Coffre** dans la barre latérale : identifiants, clés SSH et notes secrètes, déchiffrés sur l'appareil avec le mot de passe maître (même calcul que le web : Argon2id puis AES-GCM). Ajouter, modifier, supprimer, générer un mot de passe, copier un champ (effacé du presse-papiers après 90 s).
- **Face ID / Touch ID** : à activer dans le menu « … » du coffre, une fois le coffre ouvert. Le coffre se verrouille après 10 minutes sans usage et quand l'app passe en arrière-plan.
- **Notes à cadenas** : elles s'ouvrent quand le coffre est déverrouillé, et sont chiffrées de nouveau avant chaque enregistrement.
- **Remplissage automatique** : l'extension « Cairn » propose tes identifiants dans Safari et les apps, sur iPhone et sur Mac, après Face ID / Touch ID ou le mot de passe maître. Elle fonctionne sans réseau, à partir de la copie chiffrée que l'app laisse après chaque ouverture du coffre.
  - iPhone : Réglages > Général > Remplissage automatique et mots de passe > activer Cairn.
  - Mac : Réglages Système > Général > Remplissage automatique et mots de passe > activer Cairn.

### Hors ligne

- Toutes les notes sont gardées sur l'appareil (les notes à cadenas restent chiffrées). Sans réseau, tu lis, cherches, crées, modifies, déplaces et supprimes comme d'habitude.
- Les modifications attendent dans une file, dans l'ordre, et partent dès que le serveur répond : au retour du réseau, au retour dans l'app, ou avec « Synchroniser » dans le menu du compte. Le menu indique combien attendent.
- Si une note a changé ailleurs entre-temps, rien n'est écrasé : la version du serveur reste, la tienne devient une note « … (conflit) » (chiffrée elle aussi pour une note à cadenas).
- Le coffre se lit sans réseau (depuis sa copie chiffrée), mais ne se modifie qu'en ligne.
- Se déconnecter efface la copie de l'appareil ; l'app prévient s'il reste des modifications non envoyées.

Pas encore : l'agent SSH sur Mac. Voir [docs/ROADMAP.md](../../docs/ROADMAP.md), étape 5.

## Lancer l'app

Il faut un Mac avec **Xcode 16** ou plus récent.

1. Ouvrir `apps/apple/Cairn.xcodeproj`.
2. Cibles **Cairn** et **CairnAutoFill** > *Signing & Capabilities* : choisir ton équipe (*Team*). Le **compte Apple Developer payant** est nécessaire : le remplissage automatique, le groupe d'apps et le Trousseau partagé ne sont pas ouverts aux comptes gratuits. Xcode crée les identifiants (`ch.antoinequarroz.cairn`, `ch.antoinequarroz.cairn.autofill`, `group.ch.antoinequarroz.cairn`) tout seul en signature automatique.
3. Choisir la destination **My Mac** ou ton iPhone, puis ⌘R.
4. Dans l'app : l'adresse du serveur, puis « Continuer avec mon Compte Postmelo » ou le mot de passe de Cairn, et le code si la double authentification le demande.

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
| `CairnKit/` | Tout ce qui ne dessine pas : client de l'API, modèles, chiffrement du coffre, Trousseau, découpage du Markdown. Paquet Swift testé à part (`swift test`), dont un test qui ouvre un coffre créé par le code du web. Seule dépendance : libsodium (swift-sodium, figé sur un commit) pour Argon2id. |
| `Cairn/` | L'app SwiftUI : connexion, barre latérale, liste, éditeur, lecture. Xcode prend tous les fichiers du dossier (pas de liste à tenir à jour dans le projet). |
| `CairnAutoFill/` | L'extension de remplissage automatique (iPhone et Mac). |
| `Config/` | Droits (*entitlements*) de l'app et de l'extension, `Info.plist` de l'extension. |
| `Cairn.xcodeproj` | Deux cibles multiplateformes (iOS 17, macOS 14) : l'app et l'extension, embarquée dans l'app. Bac à sable activé sur Mac. |

## Sécurité

- L'app se connecte comme le navigateur : mot de passe, code, puis cookie de session. Le jeton `API_TOKEN` (pour Hermes et les scripts) n'est jamais dans l'app.
- Le cookie de session est dans le Trousseau, réservé à cet appareil (`AfterFirstUnlockThisDeviceOnly`), jamais dans les préférences.
- HTTPS obligatoire.
- Une image d'une note hébergée sur Cairn est chargée avec la session ; le cookie n'est jamais envoyé à un autre site.
- Le coffre suit les mêmes règles que sur le web, plus Face ID et le remplissage automatique : voir [docs/SECURITE.md](../../docs/SECURITE.md).
