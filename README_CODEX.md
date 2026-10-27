# Reprise Codex — Yuta et les 11

Ce fichier sert de passation pour reprendre le développement de l’application sur un autre PC. Lire aussi `README.md` pour le guide utilisateur.

## État au moment de la passation

- Version de l’application : **0.1.7**.
- Application Windows Electron, interface React/TypeScript, serveur Express, Socket.IO et base SQLite.
- L’installateur généré est `release/Yuta-et-les-11-Setup-0.1.7.exe`. Le dossier `release/` est ignoré par Git ; les installateurs sont publiés par GitHub Actions dans Releases.
- Supabase Auth gère les comptes globaux. Chaque serveur MJ conserve les profils de campagne et les données de jeu localement ; `users.auth_user_id` relie un compte Supabase à son profil SQLite sur cet hôte.
- La version 0.1.6 ajoute la liaison du compte Supabase, la connexion/inscription e-mail et les portraits de personnages hébergés dans `character-images/` sur le PC MJ.
- La version 0.1.7 ajoute l’auto‑mise‑à‑jour via les GitHub Releases publiques du dépôt `Xinoce/Yuta-et-les-11`. Au démarrage, `desktop/main.cjs` vérifie les nouvelles versions, les télécharge puis demande confirmation avant de redémarrer.
- Le dossier de travail actuel n’a pas de dépôt Git (`.git` absent). Il n’y a donc pas d’historique Git à récupérer depuis cette copie. Pour conserver les futures modifications sur plusieurs PC, initialiser un dépôt puis le pousser vers un hébergeur privé, ou transférer une archive du projet.

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
- `desktop/main.cjs` : lance le serveur local, ouvre la fenêtre Electron et gère les mises à jour.
- `tools/download-cloudflared.mjs` : télécharge cloudflared 2026.10.4 depuis la release officielle et vérifie son SHA-256. Le binaire local `tools/cloudflared.exe` est ignoré par Git et intégré à l’installateur par `npm run package:win`.
- `.github/workflows/release-windows.yml` : sur un tag `v*`, construit l’installateur Windows et publie l’EXE, le blockmap et `latest.yml` sur GitHub Releases.
- `tests/` : tests Node existants ; `npm test` les exécute.
- `dist/` : sortie générée par Vite. Modifier les fichiers de `src/`, pas ceux de `dist/`.

## Fonctions déjà présentes

- Comptes MJ et joueurs, avec changement obligatoire du mot de passe initial du compte MJ.
- Campagnes multiples ; le MJ peut en créer, les sélectionner, les mettre en pause, les reprendre, les arrêter, les réactiver et les supprimer avec confirmation.
- Si le MJ n’a pas de campagne active au démarrage, il arrive sur l’accueil de campagne, où il peut en créer une ou ouvrir une campagne existante.
- Fiches par campagne : héros, compagnons attribués à un joueur, PNJ, monstres et autres fiches MJ.
- Fiches avec caractéristiques, PV, inventaire et golds.
- Portraits pour chaque fiche, conservés sous `character-images/<campaignId>/<characterId>/` et servis après contrôle des droits de campagne.
- Connexion globale via Supabase Auth. La base MJ garde une ligne locale par joueur et la relie au `auth_user_id` Supabase. Le MJ Yuta préexistant doit se connecter avec son identifiant local, changer son mot de passe temporaire et lier son compte depuis Réglages. Un nouveau compte joueur se crée avec son adresse e-mail ; aucune clé secrète Supabase n’est requise.
- Auto‑mise‑à‑jour Electron via `electron-updater` et le provider GitHub. Le dépôt et les Releases doivent rester publics pour que les clients téléchargent les mises à jour sans jeton embarqué. `verifyUpdateCodeSignature` est désactivé faute de certificat de signature Windows ; les paquets restent vérifiés par le SHA‑512 des métadonnées reçues en HTTPS. Si une signature Windows est ajoutée, réactiver la vérification du certificat dans `package.json`.
- Lancers partagés en direct et requêtes de tests du MJ.
- Onglet **Game** : le MJ importe des images raster JPG, PNG, GIF ou WebP (10 Mo maximum), choisit l’image diffusée et peut la masquer ou la supprimer. Les joueurs ne voient que l’image sélectionnée. Le MJ et les joueurs peuvent lancer un D20 ou des dés personnalisés et consulter les derniers lancers.
- Les images Game sont conservées dans `game-images/`, et les portraits dans `character-images/` du répertoire de données. Les deux dossiers sont supprimés avec la campagne.
- L’hébergement en ligne utilise un **Cloudflare Quick Tunnel temporaire**. Il n’y a pas d’annuaire central ni de serveur permanent : le MJ doit laisser l’application ouverte et transmettre aux joueurs le lien temporaire et le mot de passe de la partie.

## Données et transfert des sauvegardes

Fermer complètement l’application avant de copier une sauvegarde SQLite. Cela évite de copier la base pendant qu’elle est ouverte.

- En développement ou avec `npm start`, `server/db.js` utilise par défaut le dossier `data/` à la racine du projet : `data/yuta.sqlite` et `data/game-images/`.
- L’application Electron définit `DATA_DIR` dans son répertoire `userData`, puis y stocke `data/yuta.sqlite` et `data/game-images/`. Sous Windows, ce répertoire se trouve normalement sous `%APPDATA%\yuta-et-les-11\data`. Si le nom varie sur la machine, le chemin peut être confirmé avec `app.getPath('userData')` dans `desktop/main.cjs`.
- Pour transférer une partie, copier **la base SQLite et les dossiers `game-images/` et `character-images/`**, puis les remettre dans le répertoire de données de l’autre PC. Les comptes locaux et leurs associations Supabase, campagnes, personnages et lancers sont dans la base ; les cartes et portraits sont des fichiers locaux. Les mots de passe Supabase ne sont pas stockés dans cette base.
- `data/` est ignoré par Git. Ne pas ajouter les sauvegardes personnelles au dépôt.

Le compte MJ `Yuta` / `admin123` n’est créé que lorsque la base ne contient encore aucun utilisateur. La première connexion impose de changer son mot de passe. Une base transférée contient déjà ses comptes et ne recrée pas cet administrateur. Supabase URL et publishable key sont configurées dans `src/supabase.ts` et en valeurs de repli côté serveur ; elles ne sont pas des secrets. Pour un autre projet, remplacer les valeurs et définir `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY`. Les confirmations d’inscription par e-mail du projet hébergé nécessitent un SMTP personnalisé pour envoyer des messages aux joueurs en dehors de l’équipe du projet ; voir la [documentation SMTP Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

## Points d’attention pour les prochaines modifications

- Les autorisations importantes doivent être vérifiées dans les routes serveur ; masquer un bouton dans React ne suffit pas.
- Les données privées des fiches ne doivent pas être envoyées à tous les clients par Socket.IO. Les événements de personnage utilisent un identifiant, puis chaque client recharge les données qu’il a le droit de voir.
- Les clients ne doivent recevoir que les images marquées comme visibles par le MJ. Les routes de fichiers contrôlent l’appartenance à la campagne.
- La suppression d’une campagne est définitive et cascade sur ses données liées ; garder la confirmation utilisateur et le contrôle serveur réservé au MJ propriétaire.
- Un changement de schéma doit rester compatible avec les bases SQLite déjà existantes et être ajouté comme migration idempotente dans `server/db.js`.
- Après des changements de code, `npm run build` valide la compilation de l’interface ; `npm run package:win` reconstruit l’installateur Windows. Le tunnel Cloudflare dépend de l’accès réseau et n’offre pas de lien permanent.

## Consigne de reprise

Pour publier la version suivante, augmenter la version racine dans `package.json` et `package-lock.json`, pousser les changements sur `main`, puis créer/pousser le tag `v<version>` (par ex. `v0.1.8`). GitHub Actions lance `npm run package:win -- --publish always`; il n’y a pas besoin d’un secret GitHub ajouté à la configuration, le workflow utilise son `GITHUB_TOKEN` limité au dépôt. La version 0.1.6 ne contient pas l’updater : les utilisateurs doivent passer manuellement à la 0.1.7.

Pour reprendre avec Codex sur un autre PC, ouvrir le dossier du projet et lui demander de lire `README_CODEX.md` ainsi que `README.md` avant de modifier le code. La version actuelle est 0.1.7 ; préserver les dossiers de sauvegarde et les fichiers `tools/` lors d’un transfert.

