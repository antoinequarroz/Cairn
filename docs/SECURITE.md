# Sécurité

## Ce qui protège quoi

| Donnée | Protection | Le serveur peut-il la lire ? |
| --- | --- | --- |
| Notes normales, fichiers joints | Mot de passe de l'app, HTTPS | Oui (recherche, API, IA) |
| Notes verrouillées | Chiffrées dans le navigateur avec la clé du coffre | Non (sauf le titre) |
| Coffre : mots de passe, clés SSH | Chiffré dans le navigateur avec la clé du coffre | Non |
| Mot de passe de l'app | Haché avec scrypt dans `data/auth.json` | Seulement le hachage |
| Mot de passe maître du coffre | Ne quitte jamais l'appareil | Non |

Concrètement : si quelqu'un vole la base, une sauvegarde, ou prend la main sur le VPS **à froid**, il obtient les notes normales, mais ni le coffre ni les notes verrouillées.

## Deux mots de passe, deux rôles

- **Mot de passe de l'app** : ouvre la porte (les notes). Vérifié par le serveur.
- **Mot de passe maître** : ouvre le coffre. Vérifié nulle part : il sert à calculer la clé, sur l'appareil. Il doit être différent du premier, long (une phrase de quelques mots), et **il ne peut pas être récupéré**. Sans lui, le coffre et les notes verrouillées sont perdus.

## Comment le coffre est chiffré

```
mot de passe maître ──Argon2id──► clé de déverrouillage ──AES-256-GCM──► clé du coffre
                                                                            │
                                              AES-256-GCM, un IV aléatoire par bloc
                                                                            ▼
                                                        éléments du coffre, notes verrouillées
```

- **Argon2id** : 64 Mo de mémoire, 3 passes, sel aléatoire de 16 octets. Rend les essais de mots de passe très lents, même avec une copie de la base.
- **Clé du coffre** : 32 octets aléatoires, générés à la création. Elle est stockée sur le serveur, mais chiffrée par la clé de déverrouillage.
- **AES-256-GCM** : chiffre et authentifie. Un bloc modifié est refusé au déchiffrement.
- **Format d'un bloc** : `v1.<IV en base64>.<chiffré en base64>`.
- La clé déverrouillée reste **en mémoire dans l'onglet** : un rechargement, ou 10 minutes sans utilisation, verrouille le coffre. Elle n'est jamais écrite dans le navigateur ni envoyée au serveur.
- Un secret copié est effacé du presse-papiers après 45 secondes (si l'onglet est resté ouvert).

Le code est dans `src/lib/crypto.ts`, avec ses tests (`pnpm test`).

## Autour

- Tout est privé sauf la page de connexion. En production, Cairn refuse de démarrer sans mot de passe.
- 8 mauvais mots de passe bloquent la connexion pendant 15 minutes.
- Changer le mot de passe de l'app déconnecte tous les autres appareils.
- `API_TOKEN` donne accès aux notes et aux fichiers, **jamais** aux routes du coffre.
- Le Markdown est nettoyé avant affichage. Les fichiers joints qui ne sont pas des images, vidéos, sons ou PDF sont toujours téléchargés, jamais affichés : un fichier HTML envoyé ne peut pas exécuter de script sur l'app.
- Cookie de session `HttpOnly`, `SameSite=Lax`, `Secure` en production.

## Limites à connaître

Mieux vaut les avoir en tête que les découvrir :

1. **Le code vient du serveur.** Comme tout gestionnaire de mots de passe web, le chiffrement est fait par du JavaScript servi par le VPS. Quelqu'un qui contrôle le VPS **pendant que tu l'utilises** pourrait servir une page modifiée qui capte le mot de passe maître. Les apps natives prévues (Tauri, iOS) retirent cette limite : leur code ne vient pas du serveur.
2. **Les notes normales ne sont pas chiffrées dans la base.** C'est le choix fait pour garder la recherche et l'IA simples. Utilise le cadenas pour ce qui est sensible, et active le chiffrement du disque du VPS si ton hébergeur le propose.
3. **Le titre d'une note verrouillée reste lisible**, ainsi que les fichiers joints à cette note.
4. **Un seul utilisateur.** Pas de comptes, pas de partage.
5. **Pas encore de double authentification** (prévue : passkeys).
6. **Pas d'audit externe.** Le chiffrement s'appuie sur des briques standard, mais l'ensemble n'a été relu par personne d'autre. Garde une copie de tes clés SSH ailleurs tant que Cairn est jeune.

## Bonnes pratiques sur le VPS

- SSH par clé uniquement, pare-feu (80, 443 et SSH), mises à jour automatiques, fail2ban.
- Sauvegardes chaque nuit, copiées hors du VPS (voir [DEPLOIEMENT.md](DEPLOIEMENT.md)). Le coffre y est déjà chiffré.
- Teste une restauration une fois.
