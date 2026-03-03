# CM Sound Player - Guide d'installation Windows

Guide complet d'installation pour Windows (Windows 10 et 11).

---

## Étape 1 : Installation de Node.js

### 1.1 Télécharger Node.js

1. Ouvrez votre navigateur web (Chrome, Edge, Firefox)
2. Allez sur : https://nodejs.org
3. Cliquez sur le bouton vert **"LTS"** (Long Term Support)
   - C'est la version recommandée (ex: 20.x.x LTS)
4. Le fichier `.msi` se télécharge (ex: `node-v20.x.x-x64.msi`)

### 1.2 Installer Node.js

1. **Double-cliquez** sur le fichier `.msi` téléchargé
2. Une fenêtre d'installation s'ouvre
3. Cliquez sur **"Next"**
4. Cochez la case **"I accept the terms in the License Agreement"**
5. Cliquez sur **"Next"**
6. Laissez le dossier d'installation par défaut : `C:\Program Files\nodejs\`
7. Cliquez sur **"Next"**
8. Sur l'écran "Custom Setup", cliquez sur **"Next"** (laissez tout coché)
9. **IMPORTANT** : Cochez la case **"Automatically install the necessary tools"**
   - Ceci installe Python et les outils de compilation Windows
10. Cliquez sur **"Next"**
11. Cliquez sur **"Install"**
12. Cliquez **"Yes"** si Windows demande les droits administrateur
13. Attendez la fin de l'installation
14. Une fenêtre PowerShell peut s'ouvrir pour installer les outils additionnels
    - Laissez-la faire son travail (cela peut prendre 5-10 minutes)
    - Elle se ferme automatiquement
15. Cliquez sur **"Finish"**

### 1.3 Vérifier l'installation

1. Appuyez sur la touche **Windows** sur votre clavier
2. Tapez : `cmd`
3. Cliquez sur **"Invite de commandes"** ou **"Command Prompt"**
4. Dans la fenêtre noire qui s'ouvre, tapez :
   ```
   node --version
   ```
5. Appuyez sur **Entrée**
6. Vous devriez voir : `v20.x.x` (ou autre version)
7. Tapez ensuite :
   ```
   npm --version
   ```
8. Vous devriez voir un numéro de version (ex: `10.x.x`)

**Si vous voyez les versions → L'installation est réussie !**

---

## Étape 2 : Télécharger le Sound Player

### Option A - Par ZIP (Recommandé pour débutants)

1. Si vous avez reçu le projet par email ou clé USB :
   - Copiez le dossier `cm-sound-player` sur votre bureau

2. Si vous téléchargez depuis GitHub :
   - Allez sur la page du projet : https://github.com/fireblock29/cm-soundplayer
   - Cliquez sur le bouton vert **"<> Code"**
   - Cliquez sur **"Download ZIP"**
   - Extrayez le ZIP sur votre Bureau
   - Renommez le dossier en `cm-sound-player`

### Option B - Par Git (Avancé)

Si Git est installé, dans l'invite de commandes :
```
cd %USERPROFILE%\Desktop
git clone https://github.com/fireblock29/cm-soundplayer cm-sound-player
```

---

## Étape 3 : Installation du projet

### 3.1 Ouvrir le dossier du projet

1. Appuyez sur la touche **Windows**
2. Tapez : `cmd`
3. Cliquez sur **"Invite de commandes"**

### 3.2 Se déplacer dans le dossier du projet

Tapez la commande (adaptez le chemin si nécessaire) :
```
cd %USERPROFILE%\Desktop\cm-sound-player
```

**Vérification** : Le prompt doit afficher quelque chose comme :
```
C:\Users\VotreNom\Desktop\cm-sound-player>
```

### 3.3 Installer les dépendances

Dans l'invite de commandes (toujours dans le dossier du projet), tapez :
```
npm install
```

**Ce qui se passe :**
- NPM télécharge et installe toutes les bibliothèques nécessaires
- Cela crée un dossier `node_modules`
- Cela peut prendre 1 à 3 minutes selon votre connexion

**Message attendu à la fin :**
```
added X packages in Xs
```

---

## Étape 4 : Préparer vos fichiers audio

1. Dans le dossier `cm-sound-player`, créez un dossier nommé :
   ```
   musiques
   ```
2. Copiez vos fichiers `.mp3` dans ce dossier `musiques`

---

## Étape 5 : Lancer le serveur

### 5.1 Démarrer l'application

Dans l'invite de commandes (toujours dans le dossier du projet), tapez :
```
npm run dev
```

**Messages attendus :**
```
> cm-sound-player@1.0.0 dev
> node server.js

Server running on http://localhost:3000
WebSocket server ready
```
Le port (le numéro 3000 après les ":") est susceptible de changer. À bien regarder !!

**Laissez cette fenêtre ouverte !** C'est le serveur qui tourne.

### 5.2 Ouvrir le player dans le navigateur

1. Ouvrez votre navigateur web
2. Tapez dans la barre d'adresse :
   ```
   http://localhost:3000
   ```
3. Appuyez sur **Entrée**
4. Le sound player s'affiche avec la liste de vos MP3

---

## Étape 6 : Utiliser la télécommande (optionnel)

### 6.1 Sur le même ordinateur

1. Dans le player principal, cliquez sur le bouton **"Remote"** (en haut à droite)
2. Notez l'URL (ex: `http://localhost:3000/remote`)
3. Ouvrez un nouvel onglet dans votre navigateur
4. Tapez cette URL

### 6.2 Sur un smartphone/tablette (même WiFi)

1. Assurez-vous que votre téléphone est sur le **même réseau WiFi** que l'ordinateur
2. Trouver l'adresse IP locale de l'ordinateur
3. Ouvrez un nouvel onglet dans votre navigateur et saisir l'url : `http://adresse_IP:3000`
4. La télécommande s'ouvre dans le navigateur de votre téléphone

---

## Arrêter le serveur

Pour arrêter le sound player :

1. Retournez dans la fenêtre d'invite de commandes où le serveur tourne
2. Appuyez sur **Ctrl + C** (maintenez Ctrl et appuyez sur C)
3. Confirmez en tapant `Y` si demandé, puis Entrée
4. Fermez la fenêtre

---

## Relancer le player (prochaines fois)

1. Ouvrez l'invite de commandes (**Windows** → tapez `cmd`)
2. Tapez :
   ```
   cd %USERPROFILE%\Desktop\cm-sound-player
   ```
3. Tapez :
   ```
   npm run dev
   ```
4. Ouvrez votre navigateur à `http://localhost:3000`

---

## Dépannage

### "node n'est pas reconnu comme commande interne"

**Cause** : Node.js n'est pas dans le PATH

**Solution** :
1. Redémarrez votre ordinateur
2. Réinstallez Node.js en cochant bien "Add to PATH"

### "npm install" échoue avec des erreurs

**Solutions possibles** :
1. Vérifiez votre connexion internet
2. Essayez :
   ```
   npm install --force
   ```
3. Ou supprimez le dossier `node_modules` et réessayez :
   ```
   rmdir /s /q node_modules
   npm install
   ```

### Le serveur démarre mais le navigateur ne trouve pas la page

**Vérifiez** :
1. Laissez le serveur démarrer complètement (attendez le message "Server running")
2. Vérifiez que vous tapez bien `http://localhost:3000` (avec les ://)
3. Vérifiez que votre antivirus/firewall ne bloque pas le port 3000

### La télécommande ne se connecte pas

**Vérifiez** :
1. Le téléphone et l'ordinateur sont sur le **même WiFi**
2. Essayez l'URL avec l'adresse IP affichée (pas `localhost`)
3. Désactivez temporairement le pare-feu Windows pour tester

---

## Commandes récapitulatives

```batch
:: Vérifier Node.js
node --version
npm --version

:: Aller dans le dossier
cd %USERPROFILE%\Desktop\cm-sound-player

:: Installer
cd %USERPROFILE%\Desktop\cm-sound-player
npm install

:: Lancer
cd %USERPROFILE%\Desktop\cm-sound-player
npm run dev

:: Arrêter
Ctrl + C
```

---

## Support

En cas de problème persistant :
1. Notez le message d'erreur exact
2. Vérifiez que vous suivez bien chaque étape dans l'ordre
3. Redémarrez votre ordinateur et réessayez

4. Appelez-moi !! Je vous apporterai de l'aide avec très grand plaisir !\
Lucas PERROT\
Voir avec Roxanne ou quelqu'un de l'année passée pour avoir mon contact ;)