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

## Étape 2 : un vrai outil de notes

- [ ] Dossiers et sous-pages, favoris, corbeille
- [ ] Recherche dans tout le texte (SQLite FTS5)
- [ ] Liens entre notes (`[[titre]]`) et rétroliens
- [ ] Éditeur plus riche : raccourcis Markdown, commande `/`, cases à cocher cliquables, coloration du code
- [ ] Historique des versions d'une note
- [ ] Export et import (dossier de fichiers `.md`)
- [ ] Hors ligne : lire et écrire sans réseau, synchroniser ensuite

## Étape 3 : l'IA

- [x] « Demander à l'IA » dans l'éditeur : résumer, améliorer, corriger, continuer, traduire, consigne libre
- [x] Branchement sur Hermes (VPS) ou sur l'API d'Anthropic ou d'OpenAI, au choix dans `.env` ([IA.md](IA.md))
- [x] Réglages > IA dans l'app : abonnement Claude (Claude Code) ou ChatGPT (Codex), clés d'API, choix du modèle, clés chiffrées sur le serveur
- [ ] Choisir le fournisseur et le modèle dans Réglages, sans toucher au `.env`
- [ ] Créer une note ou un fichier à partir d'une consigne
- [ ] Skill Hermes et commande Claude Code pour Cairn
- [ ] Questions sur l'ensemble des notes

## Étape 4 : un coffre complet

- [ ] Passkeys et double authentification pour la connexion
- [ ] Changer le mot de passe maître
- [ ] Codes à usage unique (TOTP)
- [ ] Générer une paire de clés SSH dans le coffre
- [ ] Import depuis 1Password, Bitwarden, Trousseau Apple
- [ ] Journal des accès et alerte de connexion

## Étape 5 : apps natives

- [ ] **Mac (Tauri)** : raccourci global de capture, agent SSH qui sert les clés du coffre, déverrouillage par Touch ID
- [ ] **iPhone** : Face ID, remplissage automatique des mots de passe, partage vers Cairn
- [ ] Le code du chiffrement embarqué dans l'app, et plus servi par le VPS

## Étape 6 : la suite

- [ ] Connexion unique entre Cairn, Metricove et Alfred
- [ ] Une note liée à un rendez-vous Alfred ou à un post Metricove
- [ ] Composants de design partagés entre les trois apps
