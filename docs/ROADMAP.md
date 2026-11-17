# Roadmap

## Vision

Un seul endroit, chez moi, pour ce que j'écris et ce que je dois garder secret. Simple comme un fichier Markdown, pratique comme Notion, sûr comme un gestionnaire de mots de passe. Disponible sur le web, le Mac et l'iPhone, dans la même suite que Metricove et Alfred.

## Étape 1 : la base (fait)

- [x] Notes en Markdown, aperçu, enregistrement automatique
- [x] Images, vidéos, sons et fichiers dans les notes
- [x] Coffre chiffré de bout en bout : identifiants, clés SSH, notes secrètes
- [x] Cadenas par note
- [x] Mot de passe de l'app, recherche ⌘K, thème clair et sombre
- [x] API pour Hermes et Claude Code
- [x] Docker, Caddy, sauvegardes, installable en PWA
- [x] Sauvegardes chiffrées (age) chaque nuit, copiées hors du VPS, 30 jours, script de restauration testé
- [x] Double authentification (TOTP) avec codes de secours

## Étape 2 : un vrai outil de notes

- [x] Projets, dossiers et sous-dossiers, glisser-déposer dans la barre latérale
- [ ] Sous-pages, favoris, corbeille
- [x] Recherche dans tout le texte (SQLite FTS5)
- [ ] Liens entre notes (`[[titre]]`) et rétroliens
- [x] Barre de mise en forme, raccourcis clavier et menu `/` pour écrire sans connaître le Markdown
- [ ] Éditeur plus riche : cases à cocher cliquables, coloration du code
- [ ] Historique des versions d'une note
- [x] Import (export Notion, dossier de fichiers `.md`)
- [ ] Export (dossier de fichiers `.md`)
- [ ] Hors ligne : lire et écrire sans réseau, synchroniser ensuite

## Étape 3 : l'IA

- [x] « Demander à l'IA » dans l'éditeur : résumer, améliorer, corriger, continuer, traduire, consigne libre
- [x] Branchement sur Hermes (VPS) ou sur l'API d'Anthropic ou d'OpenAI, au choix dans `.env` ([IA.md](IA.md))
- [x] Réglages > IA dans l'app : clés d'API et Hermes, choix du fournisseur et du modèle, clés chiffrées sur le serveur
- [x] Discussions avec l'IA rangées par projet et dossier, consignes par projet, notes épinglées en contexte, réponses enregistrées côté serveur
- [ ] Choisir le modèle par discussion
- [x] Rechercher dans les discussions
- [ ] Créer une note ou un fichier à partir d'une consigne
- [ ] Skill Hermes et commande Claude Code pour Cairn
- [ ] Questions sur l'ensemble des notes

## Étape 4 : un coffre complet

- [ ] Passkeys pour la connexion (la double authentification TOTP est faite)
- [ ] Changer le mot de passe maître
- [ ] Codes à usage unique (TOTP)
- [ ] Générer une paire de clés SSH dans le coffre
- [x] Import depuis 1Password, Bitwarden, NordPass, Mots de passe d'Apple et navigateurs ; export chiffré ou en clair
- [ ] Journal des accès et alerte de connexion

## Étape 5 : apps natives

Une seule app SwiftUI pour le Mac et l'iPhone ([apps/apple](../apps/apple/README.md)), plutôt que Tauri : le remplissage automatique des mots de passe sur iPhone demande de toute façon une extension native, et le même code Swift sert les deux appareils.

- [x] Première version Mac et iPhone : connexion (avec double authentification), dossiers, recherche, lecture et écriture des notes, conflits entre appareils détectés
- [x] Coffre et notes à cadenas dans l'app, déchiffrés sur l'appareil, déverrouillage par Face ID / Touch ID
- [x] Remplissage automatique des mots de passe (extension pour iPhone et Mac)
- [x] Hors ligne dans les apps : copie des notes sur l'appareil, modifications envoyées au retour du réseau, conflits gardés en copie
- [ ] **Mac** : raccourci global de capture, agent SSH qui sert les clés du coffre
- [ ] **iPhone** : partage vers Cairn
- [ ] Le code du chiffrement embarqué dans l'app, et plus servi par le VPS

## Étape 6 : la suite

- [ ] Connexion unique entre Cairn, Metricove et Alfred
- [ ] Une note liée à un rendez-vous Alfred ou à un post Metricove
- [ ] Composants de design partagés entre les trois apps
