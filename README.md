# Yuta et les 11 — La Table

Application multijoueur en français pour jouer à **Yuta et les 11**. L’interface adopte une ambiance manga/anime fantasy, sombre et prestigieuse, avec des sceaux arcanes et des accents dorés. Supabase Auth gère les identités et mots de passe ; les profils de campagne, personnages, lancers et images sont conservés sur le PC du MJ.

## Installer et démarrer sous Windows

Téléchargez puis lancez `release\Yuta-et-les-11-Setup-0.1.7.exe`. L’application s’ouvre dans sa propre fenêtre et n’exige pas que Node.js soit installé sur le PC de jeu. Un raccourci est ajouté au bureau et au menu Démarrer. Les sauvegardes sont conservées dans les données utilisateur Windows de l’application.

À partir de la 0.1.7, l’application vérifie les mises à jour au démarrage, les télécharge en arrière-plan et propose de redémarrer pour les installer. Les utilisateurs de la 0.1.6 doivent installer la 0.1.7 manuellement une première fois.

Le MJ peut héberger en ligne depuis **Réglages → Héberger en ligne**. L’application ouvre un tunnel temporaire Cloudflare vers son PC ; les joueurs n’ont pas à connaître son IP, ouvrir de port ou installer Hamachi. Ils ouvrent le lien HTTPS transmis par le MJ, puis utilisent l’ID de partie et son mot de passe. L’ID est aléatoire et ne contient pas d’information personnelle. Le mot de passe de partie est stocké sous forme hachée.

Le MJ doit laisser l’application ouverte pendant la partie. Le lien est temporaire et change à chaque ouverture. Le tunnel est fourni par Cloudflare : il sert de relais public, donc ce n’est pas une connexion directe entre joueurs. Les Quick Tunnels ne demandent ni compte ni domaine, mais Cloudflare les destine aux usages temporaires et ne garantit pas leur disponibilité ; ils s’arrêtent avec le processus et limitent à 200 les requêtes simultanées en cours ([limites Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)). Les WebSockets utilisés pour les lancers en direct sont pris en charge ([WebSockets Cloudflare](https://developers.cloudflare.com/network/websockets/)).

L’ID seul ne peut pas retrouver un MJ partout sur Internet sans annuaire permanent. Pour ne pas déployer de service supplémentaire, le MJ partage le lien temporaire avec l’ID inclus ; l’ID permet ensuite de sélectionner la bonne partie depuis ce lien. Sur le réseau local, le serveur reste aussi accessible sur le port `3001` à `http://ADRESSE-LOCALE-DU-PC-MJ:3001`.

## Première connexion

Un compte Maître du Jeu est précréé :

- **Identifiant :** `Yuta`
- **Mot de passe initial :** `admin123`

Le compte impose de choisir un nouveau mot de passe à la première connexion. Le MJ peut ensuite modifier son pseudo et son mot de passe dans **Réglages**. Gardez les identifiants privés.

## Parcours dans l’application

1. À l’ouverture, choisissez **Maître du Jeu** ou **Joueur**.
2. Le MJ se connecte, définit son mot de passe, crée sa campagne et choisit son mot de passe de partie. Dans **Réglages**, il démarre le lien en ligne, qu’il transmet aux joueurs avec le mot de passe de partie par un autre moyen.
3. Les joueurs ouvrent le lien du MJ dans leur navigateur. L’ID sélectionne directement la partie ; ils saisissent le mot de passe de partie puis créent un compte Supabase ou se connectent avec leur adresse e-mail. Un compte joueur peut rejoindre plusieurs PC MJ avec la même identité.
4. Un joueur sans personnage est dirigé vers la création de sa fiche. S’il en a déjà, il choisit lequel jouer. Plusieurs personnages peuvent être rattachés à son compte.

Les campagnes visibles apparaissent dans la liste actualisée depuis le lien du MJ. Une partie masquée peut toujours être rejointe avec son lien direct et son mot de passe. Le MJ peut mettre une campagne en pause, la reprendre, l’arrêter ou la supprimer ; s’il ne reste aucune campagne active, l’application ouvre l’accueil de campagne au prochain démarrage. Les joueurs et le MJ peuvent modifier leur pseudo dans **Réglages du compte** ; une fois Supabase lié, le mot de passe se change aussi depuis ces réglages.

Dans l’onglet **Game**, le MJ ajoute des images de carte ou de personnages et choisit celle qui est visible par les joueurs. Les joueurs voient uniquement l’image partagée. Chaque fiche (héros, compagnon, PNJ, monstre ou autre) peut aussi avoir son propre portrait/visuel, modifiable depuis la fiche. Les images sont hébergées par le PC du MJ. Le MJ et les joueurs disposent du lancer rapide de D20 et d’un petit résumé des derniers résultats, synchronisés en direct.

Supabase sert uniquement à l’authentification. La configuration du projet et sa clé **publishable** sont dans `src/supabase.ts` et dans les valeurs par défaut de `server/index.js` ; aucun secret Supabase n’est utilisé côté client ou serveur. Pour remplacer le projet, configurer `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` au moment de compiler, ainsi que `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` pour le serveur. Les comptes locaux existants restent accessibles avec leur ancien pseudo jusqu’à ce qu’ils lient un compte Supabase dans Réglages. Le premier MJ conserve son profil `Yuta`, change le mot de passe temporaire, crée une première campagne, puis lie son compte depuis Réglages.

Pour les inscriptions avec confirmation par e-mail, configurez un serveur SMTP personnalisé dans les paramètres Auth de Supabase : le service e-mail intégré aux projets hébergés n’envoie qu’aux membres de l’organisation et est limité à 2 e-mails par heure ([documentation SMTP Supabase](https://supabase.com/docs/guides/auth/auth-smtp)). La confirmation peut être désactivée pour un essai fermé, mais les adresses ne seront alors pas vérifiées.

## Lancer depuis les sources

Installez Node.js 20 ou une version LTS récente, puis lancez dans PowerShell :

```powershell
npm install
npm run dev
```

Ouvrez [http://localhost:5173](http://localhost:5173). Pour lancer le serveur de production, exécutez `npm run build`, puis `npm start`. L’application sera disponible sur le port `3001`.

Pour reconstruire l’installateur Windows :

```powershell
npm install
npm run package:win
```

Le fichier généré se trouve dans `release\Yuta-et-les-11-Setup-0.1.7.exe`.

## Publier une mise à jour

Le dépôt public [Xinoce/Yuta-et-les-11](https://github.com/Xinoce/Yuta-et-les-11) publie les installateurs sur GitHub Releases. Pour une nouvelle version, mettez à jour la version de `package.json`, poussez le code sur `main`, puis créez et poussez un tag correspondant, par exemple `v0.1.8`. GitHub Actions compile Windows et publie l’installateur ainsi que les métadonnées utilisées par l’auto‑mise‑à‑jour.

## Socle de jeu

- Comptes Supabase Auth (e-mail et mot de passe), reliés à un profil local sur chaque PC MJ ; les campagnes et ressources restent chez le MJ.
- Plusieurs campagnes par MJ, avec sélection, pause, reprise, arrêt et suppression confirmée.
- Écran **Game** avec partage d’images par le MJ, aperçu joueur en direct, lancer de D20 et résumé compact des résultats.
- Fiches créées par le MJ comme PNJ, monstres, autres fiches ou compagnons attribués à un joueur ; un joueur peut choisir parmi plusieurs héros et compagnons jouables.
- Fiches personnage illustrables (portrait JPG, PNG, GIF ou WebP jusqu’à 10 Mo) avec les sept caractéristiques et la répartition officielle des bonus `+3, +2, +1, +1, +0, +0, +0`.
- Inventaire et golds suivis par personnage, modifiables par le MJ et consultables par le joueur.
- Lancers rapides et personnalisés, historique conservé et partagé en direct.
- Requêtes de test du MJ, difficulté, caractéristique, modificateurs et résolution par le joueur visé.
- Présence des participants et interface adaptée aux petits écrans.

## Vérifications

```powershell
npm test
npm run build
```


