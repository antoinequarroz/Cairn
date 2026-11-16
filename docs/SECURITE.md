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

## Ce que l'IA voit

Le bouton « IA » n'envoie quelque chose que lorsque tu choisis une action, et seulement ceci :

| Envoyé au fournisseur d'IA | Jamais envoyé |
| --- | --- |
| Le passage sélectionné, ou la note si rien n'est sélectionné (pour « Continuer » : le texte avant le curseur) | Le coffre |
| Le titre de la note | Les notes chiffrées de bout en bout |
| Ta consigne, pour « Consigne libre » | Les autres notes, les fichiers joints |

- **Notes chiffrées** : l'IA y est désactivée, même quand la note est déverrouillée à l'écran. S'en servir enverrait le texte déchiffré au serveur, puis au fournisseur. Le blocage est fait dans le code qui envoie la demande, pas seulement dans le menu.
- **Où part le texte** : avec Hermes, il va de Cairn à Hermes sans quitter le VPS, puis Hermes l'envoie au modèle que tu lui as configuré. Avec Anthropic ou OpenAI, il part chez eux, sous leurs conditions d'API. Sans fournisseur configuré, rien ne part nulle part.
- **Les clés d'API** restent dans le `.env` du serveur. Le navigateur ne les reçoit jamais, et elles sont retirées des messages d'erreur, comme les identifiants qu'une adresse pourrait contenir (`utilisateur:motdepasse@`).
- **Une note ne commande pas l'IA** : son contenu et son titre sont présentés au modèle comme un texte à travailler, pas comme des instructions, entre des balises au nom tiré au hasard à chaque demande (un texte collé qui contient `</note>` ne referme rien). C'est une défense en profondeur, pas une garantie : un modèle peut quand même se laisser influencer. Relis ce que l'IA propose avant de l'insérer. Rien n'est écrit dans la note sans ton clic. Avec Hermes, la vraie limite est celle des outils que tu as donnés à l'agent.
- **La réponse ne charge rien d'un autre site** : dans le panneau, elle est affichée sans image, vidéo ni style distants (ils deviennent des liens à cliquer). Sinon, un texte piégé pourrait faire écrire à l'IA une adresse d'image qui emporte un bout de la note vers un tiers, avant même ton clic. Une fois insérée dans la note, la réponse est du Markdown comme le reste : l'aperçu affiche alors ses images.
- `API_TOKEN` donne aussi accès à `/api/ai` : un script qui a le jeton peut utiliser ton IA (et donc ta clé ou ton Hermes).

## Limites à connaître

Mieux vaut les avoir en tête que les découvrir :

1. **Le code vient du serveur.** Comme tout gestionnaire de mots de passe web, le chiffrement est fait par du JavaScript servi par le VPS. Quelqu'un qui contrôle le VPS **pendant que tu l'utilises** pourrait servir une page modifiée qui capte le mot de passe maître. Les apps natives prévues (Tauri, iOS) retirent cette limite : leur code ne vient pas du serveur.
2. **Les notes normales ne sont pas chiffrées dans la base.** C'est le choix fait pour garder la recherche et l'IA simples. Et ce que tu confies au bouton « IA » sort du VPS si le fournisseur est Anthropic ou OpenAI. Utilise le cadenas pour ce qui est sensible, et active le chiffrement du disque du VPS si ton hébergeur le propose.
3. **Le titre d'une note verrouillée reste lisible**, ainsi que les fichiers joints à cette note.
4. **Un seul utilisateur.** Pas de comptes, pas de partage.
5. **Pas encore de double authentification** (prévue : passkeys).
6. **Pas d'audit externe.** Le chiffrement s'appuie sur des briques standard, mais l'ensemble n'a été relu par personne d'autre. Garde une copie de tes clés SSH ailleurs tant que Cairn est jeune.

## Bonnes pratiques sur le VPS

- SSH par clé uniquement, pare-feu (80, 443 et SSH), mises à jour automatiques, fail2ban.
- Sauvegardes chaque nuit, copiées hors du VPS (voir [DEPLOIEMENT.md](DEPLOIEMENT.md)). Le coffre y est déjà chiffré.
- Teste une restauration une fois.
