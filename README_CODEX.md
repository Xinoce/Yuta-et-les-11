# Reprise Codex — Yuta et les 11

Ce fichier sert de passation pour reprendre le développement de l’application sur un autre PC. Lire aussi `README.md` pour le guide utilisateur.

## État au moment de la passation

- Version actuelle : **0.2.2**.
- Application Windows Electron, interface React/TypeScript, serveur Express, Socket.IO et base SQLite.
- L’installateur généré est `release/Yuta-et-les-11-Setup-0.2.2.exe`. Le dossier `release/` est ignoré par Git ; les installateurs sont publiés par GitHub Actions dans Releases.
- Supabase Auth gère les comptes globaux. Chaque serveur MJ conserve les profils de campagne et les données de jeu localement ; `users.auth_user_id` relie un compte Supabase à son profil SQLite sur cet hôte.
- La version 0.1.6 ajoute la liaison du compte Supabase, la connexion/inscription e-mail et les portraits de personnages hébergés dans `character-images/` sur le PC MJ.
- La version 0.1.7 ajoute l’auto‑mise‑à‑jour via les GitHub Releases publiques du dépôt `Xinoce/Yuta-et-les-11`. Au démarrage, `desktop/main.cjs` vérifie les nouvelles versions, les télécharge puis demande confirmation avant de redémarrer.
- La version 0.1.8 corrige le démarrage lorsque le port 3001 est déjà occupé et évite les lancements multiples de l’application.
- La version 0.1.9 apporte les boutons Retour, Menu principal et Déconnexion ; la compilation de cette release a échoué, et les mêmes changements sont repris en 0.1.10 après correction de `src/App.tsx` sur `main`.
- La version 0.1.11 ajoute les comptes joueurs sans campagne, les IDs sociaux, les demandes de contact et les invitations privées de partie. Appliquer la migration supabase/migrations/20261102000000_social_friends_invites.sql dans le SQL Editor du projet avant utilisation de Amis.
- La version 0.1.12 cible le nouveau projet Supabase `https://cbwdbjwpexgxbewdpnzh.supabase.co`. Après une migration de projet, l’API serveur peut relier un profil SQLite existant au nouveau compte Supabase quand l’adresse e-mail correspond et est confirmée. Les comptes Auth, IDs, amitiés et invitations de l’ancien projet ne sont pas copiés automatiquement ; la migration SQL sociale doit aussi être exécutée dans le nouveau projet.
- La version 0.1.13 ajoute l’inscription Supabase des comptes MJ, retire le compte administrateur précréé et adapte l’échelle globale de l’interface aux écrans 2K et plus.
- La version 0.1.14 crée les identifiants d’amis `pseudo#0000` dans Supabase, convertit les anciens IDs sociaux à l’application de la migration et affiche les erreurs PostgREST réelles au lieu d’un message générique.
- La version 0.1.15 fait écouter le serveur local uniquement sur `127.0.0.1` pour éviter l’exposition réseau locale et les demandes entrantes du pare-feu Windows. Le contrôle de démarrage vérifie la disponibilité locale et l’enregistrement du tunnel Cloudflare, sans faire rebondir le test par l’URL publique depuis le PC du MJ.
- La version 0.1.16 ajoute la recherche manuelle et l’installation différée des mises à jour depuis Réglages, les dessins du MJ sur l’image partagée et les jetons personnalisables, déplaçables et attribuables à un ou plusieurs joueurs.
- La version 0.1.17 intègre l’icône Windows fournie par l’utilisateur dans l’exécutable, les raccourcis, l’installeur et le désinstalleur.
- La version 0.1.18 affiche en bleu l’information demandant de confirmer l’adresse e-mail après l’inscription.
- La version 0.2.0 ajoute un accueil illustré distinct pour MJ et joueur, avec campagne, amis et module de dés. Le visuel conserve son ratio avec des bandes noires selon la fenêtre ; le portrait par défaut est intégré sous la zone transparente du décor et peut être remplacé localement.
- La version 0.2.1 rend l’accueil adaptatif en 1080p et dans les fenêtres basses : les panneaux se réorganisent en grille, la page défile au besoin et les écrans étroits empilent les panneaux.
- La version 0.2.2 conserve le tableau de bord illustré et adapte seulement l’échelle de l’artboard aux dimensions de la fenêtre, sans réorganiser ses panneaux.
- Cette copie de travail n’a pas de dossier Git (`.git` absent). Le dépôt distant du projet est [Xinoce/Yuta-et-les-11](https://github.com/Xinoce/Yuta-et-les-11) ; récupérer son historique avec `git clone` pour une nouvelle copie de développement.

## Installer le projet sur un autre PC

1. Copier le dossier du projet. Pour une copie des sources, conserver `package.json`, `package-lock.json`, `src/`, `server/`, `desktop/`, `tools/`, `tests/`, `README.md` et ce fichier.
2. Installer Node.js **20 ou plus récent** (version LTS recommandée).
3. Depuis PowerShell, dans le dossier du projet :

   ```powershell
   npm ci
   npm run dev
   ```

4. Ouvrir `http://localhost:5173`.

`npm run dev` démarre le serveur API sur le port `3001` et Vite sur le port `5173`. Vite transmet `/api` et `/socket.io` au serveur local. Pour servir la version web compilée, utiliser `npm run build`, puis `npm start` ; elle est disponible sur `http://localhost:3001`.

Pour fabriquer l’installateur Windows depuis le PC de reprise :

```powershell
npm ci
npm run package:win
```

Le fichier est produit dans `release/`. Le nom inclut automatiquement la version de `package.json`. Pour publier une nouvelle version, mettre à jour les versions racine dans `package.json` et `package-lock.json`, puis actualiser les références de version dans `README.md`.

## Architecture du projet

- `src/App.tsx` : navigation, flux de connexion Supabase et compatibilité de migration locale, campagnes, fiches et portraits, table et onglet **Game**.
- `src/supabase.ts` : client Supabase Auth et paramètres du projet. La publishable key peut être incluse dans l’application ; ne jamais mettre une clé `secret` ou `service_role` dans ce fichier.
- `src/styles.css` et `src/theme.css` : styles de l’application.
- `server/index.js` : API REST, validation de l’identité Supabase via Auth, autorisations, Socket.IO, tunnel Cloudflare et fichiers d’images de jeu et portraits.
- `server/db.js` : création de la base et migrations SQLite. Ajouter les changements de schéma ici afin qu’ils s’appliquent aussi aux anciennes bases.
- `server/domain.js` et `server/auth.js` : règles métier et authentification.
- `server/online.js` : démarrage, état et arrêt du tunnel Cloudflare temporaire.
- `desktop/main.cjs` et `desktop/preload.cjs` : lancent le serveur local, ouvrent la fenêtre Electron et exposent le contrôle sécurisé des mises à jour à l’interface.
- `tools/download-cloudflared.mjs` : télécharge cloudflared 2026.10.4 depuis la release officielle et vérifie son SHA-256. Le binaire local `tools/cloudflared.exe` est ignoré par Git et intégré à l’installateur par `npm run package:win`.
- `build/yuta-icone.ico` : icône Windows 256×256 appliquée à l’application, à l’installeur et au désinstalleur.
- `.github/workflows/release-windows.yml` : sur un tag `v*`, construit l’installateur Windows et publie l’EXE, le blockmap et `latest.yml` sur GitHub Releases.
- `tests/` : tests Node existants ; `npm test` les exécute.
- `dist/` : sortie générée par Vite. Modifier les fichiers de `src/`, pas ceux de `dist/`.

## Fonctions déjà présentes

- Comptes MJ et joueurs créés ou connectés via Supabase Auth.
- Campagnes multiples ; le MJ peut en créer, les sélectionner, les mettre en pause, les reprendre, les arrêter, les réactiver et les supprimer avec confirmation.
- Si le MJ n’a pas de campagne active au démarrage, il arrive sur l’accueil de campagne, où il peut en créer une ou ouvrir une campagne existante.
- Fiches par campagne : héros, compagnons attribués à un joueur, PNJ, monstres et autres fiches MJ.
- Fiches avec caractéristiques, PV, inventaire et golds.
- Portraits pour chaque fiche, conservés sous `character-images/<campaignId>/<characterId>/` et servis après contrôle des droits de campagne.
- Comptes créables sans campagne, ID public `pseudo#0000`, demandes de contact et invitations privées entre amis via Supabase.
- Connexion globale via Supabase Auth. La base MJ garde une ligne locale par compte et la relie au `auth_user_id` Supabase. Un compte MJ comme joueur peut être créé avec son adresse e-mail ; aucune clé secrète Supabase n’est requise.
- Auto‑mise‑à‑jour Electron via `electron-updater` et le provider GitHub. Le dépôt et les Releases doivent rester publics pour que les clients téléchargent les mises à jour sans jeton embarqué. `verifyUpdateCodeSignature` est désactivé faute de certificat de signature Windows ; les paquets restent vérifiés par le SHA‑512 des métadonnées reçues en HTTPS. Si une signature Windows est ajoutée, réactiver la vérification du certificat dans `package.json`.
- Lancers partagés en direct et requêtes de tests du MJ.
- Onglet **Game** : le MJ importe des images raster JPG, PNG, GIF ou WebP (10 Mo maximum), choisit l’image diffusée et peut la masquer ou la supprimer. Il peut dessiner sur l’image, puis créer des jetons nommés et colorés, les attribuer à plusieurs joueurs et déplacer tous les jetons. Chaque joueur peut déplacer seulement les jetons qui lui sont attribués. Dessins et positions sont sauvegardés localement dans SQLite et synchronisés dans Socket.IO. Le MJ et les joueurs peuvent lancer un D20 ou des dés personnalisés et consulter les derniers lancers.
- Réglages inclut un contrôle manuel de mise à jour et la progression du téléchargement. La mise à jour se télécharge en arrière-plan et ne s’installe qu’après le redémarrage demandé par l’utilisateur.
- Les images Game sont conservées dans `game-images/`, et les portraits dans `character-images/` du répertoire de données. Les deux dossiers sont supprimés avec la campagne.
- L’hébergement en ligne utilise un **Cloudflare Quick Tunnel temporaire**. Il n’y a pas d’annuaire central ni de serveur permanent : le MJ doit laisser l’application ouverte et transmettre aux joueurs le lien temporaire et le mot de passe de la partie.
- Au démarrage Electron, le serveur tente le port `3001`, puis prend automatiquement un port libre si celui-ci est occupé. Le tunnel reçoit le port réellement ouvert via `server.address()`. L’application empêche aussi plusieurs fenêtres Yuta simultanées : un second lancement ramène la fenêtre existante au premier plan.

## Données et transfert des sauvegardes

Fermer complètement l’application avant de copier une sauvegarde SQLite. Cela évite de copier la base pendant qu’elle est ouverte.

- En développement ou avec `npm start`, `server/db.js` utilise par défaut le dossier `data/` à la racine du projet : `data/yuta.sqlite` et `data/game-images/`.
- L’application Electron définit `DATA_DIR` dans son répertoire `userData`, puis y stocke `data/yuta.sqlite` et `data/game-images/`. Sous Windows, ce répertoire se trouve normalement sous `%APPDATA%\yuta-et-les-11\data`. Si le nom varie sur la machine, le chemin peut être confirmé avec `app.getPath('userData')` dans `desktop/main.cjs`.
- Pour transférer une partie, copier **la base SQLite et les dossiers `game-images/` et `character-images/`**, puis les remettre dans le répertoire de données de l’autre PC. Les comptes locaux et leurs associations Supabase, campagnes, personnages et lancers sont dans la base ; les cartes et portraits sont des fichiers locaux. Les mots de passe Supabase ne sont pas stockés dans cette base.
- `data/` est ignoré par Git. Ne pas ajouter les sauvegardes personnelles au dépôt.

Il n’y a plus de compte MJ précréé. Au démarrage, le serveur supprime l’ancien compte de démarrage `yuta@local.invalid` s’il n’a pas de campagne ; un compte MJ possédant des campagnes est conservé. Supabase URL et publishable key sont configurées dans `src/supabase.ts` et en valeurs de repli côté serveur ; elles ne sont pas des secrets. Pour un autre projet, remplacer les valeurs et définir `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY`. Les confirmations d’inscription par e-mail du projet hébergé nécessitent un SMTP personnalisé pour envoyer des messages aux joueurs en dehors de l’équipe du projet ; voir la [documentation SMTP Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

## Points d’attention pour les prochaines modifications

- Les autorisations importantes doivent être vérifiées dans les routes serveur ; masquer un bouton dans React ne suffit pas.
- Les données privées des fiches ne doivent pas être envoyées à tous les clients par Socket.IO. Les événements de personnage utilisent un identifiant, puis chaque client recharge les données qu’il a le droit de voir.
- Les clients ne doivent recevoir que les images marquées comme visibles par le MJ. Les routes de fichiers contrôlent l’appartenance à la campagne.
- La suppression d’une campagne est définitive et cascade sur ses données liées ; garder la confirmation utilisateur et le contrôle serveur réservé au MJ propriétaire.
- Un changement de schéma doit rester compatible avec les bases SQLite déjà existantes et être ajouté comme migration idempotente dans `server/db.js`.
- Après des changements de code, `npm run build` valide la compilation de l’interface ; `npm run package:win` reconstruit l’installateur Windows. Le tunnel Cloudflare dépend de l’accès réseau et n’offre pas de lien permanent.

## Consigne de reprise

Pour publier la version suivante, augmenter la version racine dans package.json et package-lock.json, pousser le code sur main puis créer et pousser le tag correspondant. Le workflow compile sans publication electron-builder puis utilise GitHub CLI et son GITHUB_TOKEN pour créer la release et téléverser installateur, blockmap et latest.yml.

Pour reprendre avec Codex sur un autre PC, ouvrir le dossier du projet et lui demander de lire `README_CODEX.md` ainsi que `README.md` avant de modifier le code. La version actuelle est 0.2.2 ; préserver les dossiers de sauvegarde et les fichiers `tools/` lors d’un transfert.


