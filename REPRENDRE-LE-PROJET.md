# Reprendre le Breath Logger

Ce guide est pour toi qui reprends le projet : installer ton poste de travail, régler le
boîtier dans `config.h`, compiler, installer le logiciel sur tes boîtiers, et publier tes
propres versions. Compte environ une heure la première fois, surtout du téléchargement.

> **Tu veux seulement utiliser les boîtiers, sans toucher au code ?** Télécharge le `.zip`
> de la dernière version dans l'onglet **Releases** du dépôt, puis suis le
> [README](README.md#use-the-device) à partir de « Use the device ». Rien à installer.

**Sommaire**

1. [Ce que tu reçois](#1-ce-que-tu-reçois)
2. [Le matériel](#2-le-matériel)
3. [Installer ton poste de travail](#3-installer-ton-poste-de-travail)
4. [Récupérer le code et compiler](#4-récupérer-le-code-et-compiler)
5. [Régler le boîtier : `config.h`](#5-régler-le-boîtier--configh)
6. [Installer le logiciel sur tes boîtiers](#6-installer-le-logiciel-sur-tes-boîtiers)
7. [Publier une version](#7-publier-une-version)
8. [À savoir avant de montrer des courbes](#8-à-savoir-avant-de-montrer-des-courbes)
9. [Où trouver quoi](#9-où-trouver-quoi)

---

## 1. Ce que tu reçois

| | Quoi | Pour quoi faire |
|---|---|---|
| **Le dépôt** | Ce code : le firmware du boîtier, la page web, les outils de test, la documentation, tout l'historique | Modifier et recompiler |
| **Le dossier prêt à l'emploi** | Un `.zip` d'environ 27 Mo dans **Releases** : firmware déjà compilé, page, outil d'installation USB, Python portable | Utiliser les boîtiers sur un PC Windows |

Le dossier prêt à l'emploi se fabrique à partir du dépôt avec une seule commande
([étape 6](#6-installer-le-logiciel-sur-tes-boîtiers)) : tu n'en dépends pas.

## 2. Le matériel

| Élément | Ce qu'il faut |
|---|---|
| Carte | Seeed **XIAO ESP32-S3** avec **8 Mo de mémoire flash**, sur notre circuit imprimé |
| Antenne Wi-Fi | L'antenne livrée avec la XIAO, **clipsée sur le connecteur U.FL** à côté du module. Sans elle, le Wi-Fi porte à peine |
| Carte capteurs (bus I2C sur D4/D5) | LPS28DFW (pression), DS1307 (horloge) **alimenté en 5 V** avec sa pile, LSM6DSM (accéléromètre, pas encore utilisé) |
| Carte SD | Formatée en **FAT32**. Une carte de 8 à 32 Go l'est déjà ; au-delà, la reformater (par exemple avec [Rufus](https://rufus.ie), « Large FAT32 ») |
| Autres broches de notre carte | Bouton D6, LED rouge D1, verte D0, bleue D2 (pas encore utilisés), batterie sur D3 |
| PC | Windows 10 ou 11, avec Chrome ou Edge (Firefox ne sait pas parler au port USB) |

Une autre carte ESP32-S3 marche si elle a au moins 8 Mo de flash : le firmware est rangé
en deux emplacements de 3,2 Mo (pour la mise à jour à distance). Il faut alors adapter les
broches dans `config.h` ([section 5](#5-régler-le-boîtier--configh)).

## 3. Installer ton poste de travail

On compile dans **WSL** (un Ubuntu intégré à Windows) et on installe sur les boîtiers depuis
Windows. Sous Linux, saute l'étape 3.1.

### 3.1 WSL

Dans PowerShell **lancé en administrateur**, puis redémarre le PC :

```powershell
wsl --install
```

Au premier lancement d'**Ubuntu** (menu Démarrer), choisis un nom d'utilisateur et un mot de
passe. Toutes les commandes suivantes se tapent dans ce terminal Ubuntu.

### 3.2 Les outils

```bash
sudo apt update && sudo apt install -y git python3-venv
```

Pour éditer le code : [VS Code](https://code.visualstudio.com/) sous Windows, avec son
extension **WSL**. La commande `code .` dans le terminal Ubuntu ouvre alors le dossier.

### 3.3 Se connecter à GitHub

GitHub refuse le mot de passe du compte pour `git` (« Password authentication is not
supported »). Deux façons de se connecter, au choix :

- **Si [Git pour Windows](https://git-scm.com/download/win) est installé** : le Git de WSL
  peut utiliser sa fenêtre de connexion par navigateur.
  ```bash
  git config --global credential.helper "/mnt/c/Program\ Files/Git/mingw64/bin/git-credential-manager.exe"
  ```
- **Sinon**, avec l'outil de GitHub :
  ```bash
  sudo apt install -y gh
  gh auth login        # GitHub.com → HTTPS → Login with a web browser
  ```

## 4. Récupérer le code et compiler

Accepte d'abord l'invitation au dépôt (reçue par e-mail ou sur github.com), puis :

```bash
cd ~
git clone https://github.com/gitvrz/breath-logger.git
cd breath-logger
python3 -m venv .venv
.venv/bin/pip install platformio
.venv/bin/pio run -d firmware        # doit finir par SUCCESS
```

PlatformIO est l'outil qui compile le code Arduino de l'ESP32. La première compilation
télécharge le compilateur et les bibliothèques, environ 2 Go : compte quelques minutes.

> **Sans WSL**, sous Windows : installe VS Code et son extension **PlatformIO IDE**, ouvre le
> dossier `firmware`, compile avec ✓ dans la barre bleue du bas. Le reste du guide suppose WSL.

## 5. Régler le boîtier : `config.h`

Tous les réglages sont dans **`firmware/src/config.h`**, chacun expliqué en commentaire. Tu
n'as presque jamais besoin de toucher aux autres fichiers. Après chaque modification :
recompile, puis installe ([section 6](#6-installer-le-logiciel-sur-tes-boîtiers)).

```bash
code firmware/src/config.h
```

Les valeurs ci-dessous sont celles du dépôt aujourd'hui.

### Capteurs

| Réglage | Valeur | Ce que ça fait |
|---|---|---|
| `USE_SIMULATED_SENSORS` | `1` | `1` : le boîtier fabrique une respiration réaliste, sans aucun capteur (démonstration, développement). `0` : il lit la carte capteurs. **À passer à `0` pour mesurer.** |
| `PRESSURE_BASELINE_S` | `60` | La courbe Pression est l'écart à la pression atmosphérique, elle-même moyennée sur ce nombre de secondes |
| `FLOW_COEF` | `-76.0f` | Débit (L/min) = ce coefficient × pression (cmH₂O). **Pas encore étalonné.** Négatif : on expire quand le débit est négatif |
| `SAMPLE_RATE_HZ` | `50` | Mesures par seconde. Doit diviser 1000 |

### CO₂ et O₂ calculés (en attendant les capteurs de gaz)

Avec `USE_SIMULATED_SENSORS 0`, le CO₂ et l'O₂ sont **calculés** à partir de la respiration
mesurée, comme un vrai capnogramme : rien en début d'expiration (espace mort), montée vers
la valeur de fin d'expiration, retour à l'air ambiant à l'inspiration.

| Réglage | Valeur | Ce que ça fait |
|---|---|---|
| `SIM_GAS` | `1` | `0` : CO₂ et O₂ restent vides (« Pas de capteur » sur la page) |
| `SIM_EXPIRATION_SIGN` | `-1` | Signe du débit quand on expire. Si le CO₂ monte à l'inspiration, passe-le à `1` |
| `SIM_GAS_DP_THRESHOLD` | `0.05f` | cmH₂O : zone morte. Le bruit du capteur doit rester dedans. **À monter si les courbes de gaz réagissent au bruit** |
| `SIM_GAS_PHASE_INTEGRAL` | `0.02f` | cmH₂O × s qu'il faut accumuler hors de la zone morte pour changer de phase. À baisser si des respirations faibles sont ratées |
| `SIM_ETCO2` | `5.0f` | % de CO₂ en fin d'expiration |
| `SIM_CO2_DEAD_S`, `SIM_CO2_RISE_S` | `0.15f`, `0.10f` | Durée de l'espace mort, vitesse de montée du CO₂ (s) |
| `SIM_O2_PER_CO2` | `1.2f` | % d'O₂ consommé par % de CO₂ rejeté (O₂ ≈ 15 % en fin d'expiration) |
| `SIM_GAS_LAG_S` | `0.08f` | Retard d'un capteur de gaz (s) |

### Horloge et batterie

| Réglage | Valeur | Ce que ça fait |
|---|---|---|
| `RTC_ENABLED` | `1` | Le DS1307 garde l'heure boîtier éteint. `0` : c'est la page qui donne l'heure à chaque connexion |
| `BATTERY_SIMULATED` | `1` | `1` : batterie **fictive** (pleine au démarrage, vide après `BATTERY_SIM_HOURS` heures). `0` : tension lue sur `PIN_BATTERY` |
| `PIN_BATTERY` | `4` | D3 |
| `BATTERY_DIVIDER` | `2.0f` | Tension batterie / tension sur la broche. **À vérifier** sur la carte (valeurs des résistances, ou comparaison au multimètre) avant de passer `BATTERY_SIMULATED` à `0` |

### Wi-Fi

| Réglage | Valeur | Ce que ça fait |
|---|---|---|
| `WIFI_ENABLED` | `1` | `0` : USB seulement |
| `WIFI_PASSWORD` | `"breathlogger"` | **Le même pour tous les boîtiers** pour l'instant |
| `WIFI_CHANNEL` | `0` | `0` : à chaque mise sous tension, le boîtier choisit le canal le moins encombré parmi 1, 6 et 11 |

### Broches, si ta carte est différente

| Réglage | Valeur | Branchement sur notre carte |
|---|---|---|
| `PIN_I2C_SDA`, `PIN_I2C_SCL` | `5`, `6` | D4, D5 (résistances de rappel sur la carte) |
| `PIN_SD_D3` (CS), `PIN_SD_CLK`, `PIN_SD_D0` (MISO), `PIN_SD_CMD` (MOSI) | `44`, `7`, `8`, `9` | D7, D8, D9, D10 |

### Version

| Réglage | Valeur | Ce que ça fait |
|---|---|---|
| `FW_VERSION` | `"0.3.0"` | Affichée par la page et dans le nom du `.zip`. **Monte-la à chaque version que tu donnes** |

## 6. Installer le logiciel sur tes boîtiers

### 6.1 Fabriquer ton dossier Windows

```bash
python3 package/package.py --out /mnt/c/Users/<ton-nom-windows>/BreathLogger
```

Cette commande compile le firmware et crée (ou met à jour) le dossier `BreathLogger` côté
Windows : firmware, page, `flash.bat`, raccourci, outils de test. La première fois, elle
télécharge aussi esptool et un Python portable (versions fixées et vérifiées).

> WSL ne voit pas les ports USB. C'est pour ça qu'on compile dans WSL et qu'on installe
> depuis Windows.

### 6.2 La première fois sur un boîtier : `flash.bat`

1. Ferme la page Breath Logger si elle est ouverte (elle occupe le port USB).
2. Branche le boîtier en USB-C.
3. Double-clique sur `BreathLogger\flash.bat`, appuie sur **Entrée** pour qu'il trouve le
   port tout seul, attends « Firmware installe ».

Si ça échoue (« Failed to connect », fréquent sur une carte neuve) : débranche, rebranche
**en maintenant le petit bouton B** de la XIAO, relance `flash.bat`. Ce n'est utile qu'une fois.

### 6.3 Les fois suivantes : depuis la page

Ouvre la page (raccourci créé par `launcher\Creer le raccourci.bat`), connecte-toi au
boîtier, puis **Mettre à jour le firmware** avec `BreathLogger\firmware\firmware.bin`. Ça
marche aussi en Wi-Fi. Si le nouveau firmware ne démarre pas, le boîtier revient tout seul
à l'ancien.

### 6.4 Vérifier

Le panneau de l'appareil, sur la page, affiche la version (« Firmware 0.3.0 · 50 Hz »). Le
bouton **Mettre à jour le firmware** ouvre une fenêtre qui donne aussi la date de
compilation et le commit, par exemple `2026-10-22 14:05:05 689dac3`. Un `+` à la fin veut
dire que le code compilé n'était pas commité.

Pour un test complet du boîtier (enregistrement, carte SD, USB), dans une invite de
commandes Windows ouverte dans le dossier `BreathLogger`, page fermée :

```
tools\python\python.exe tools\devtest.py COM5
```

Remplace `COM5` par le port du boîtier (Gestionnaire de périphériques → Ports COM).

## 7. Publier une version

```bash
git add firmware webapp docs          # ce que tu as modifié
git commit -m "Ce qui change, en une phrase"
git push
```

Pour donner une version prête à l'emploi :

1. Monte `FW_VERSION` dans `config.h`, commit, push.
2. `python3 package/package.py` fabrique `dist/BreathLogger-<version>-<commit>.zip`.
   Vérifie que le nom ne finit pas par `+`.
3. Sur GitHub : **Releases → Draft a new release**, tag `v<version>`, glisse le `.zip`,
   **Publish release**.

À plusieurs : chacun travaille sur sa branche (`git switch -c ma-modif`), puis propose ses
changements sur GitHub par une *pull request* que l'autre relit avant de fusionner.

## 8. À savoir avant de montrer des courbes

Rien de ceci n'est indiqué sur la page ni dans les fichiers enregistrés : c'est un choix de
l'équipe, à garder en tête.

- [ ] Avec `USE_SIMULATED_SENSORS 1` (valeur actuelle du dépôt), **toutes les courbes sont
      simulées**.
- [ ] Avec `USE_SIMULATED_SENSORS 0`, le **CO₂ et l'O₂ sont calculés**, pas mesurés
      (`SIM_GAS 1`).
- [ ] Le **débit n'est pas étalonné**. Le coefficient utilisé est noté dans chaque session
      (`flow_coef` dans `meta.json`) : on peut recalculer le débit à partir de la pression.
- [ ] La **batterie affichée est fictive** tant que `BATTERY_SIMULATED` vaut `1`.
- [ ] Le **DS1307 doit être alimenté en 5 V**. Sinon, le boîtier n'a l'heure que quand une
      page se connecte.
- [ ] Le **mot de passe Wi-Fi** est le même pour tous les boîtiers.

## 9. Où trouver quoi

| Fichier | Contenu |
|---|---|
| [`README.md`](README.md) | Utiliser le boîtier, dépannage (en anglais) |
| [`docs/development.md`](docs/development.md) | Compiler, organisation du code fichier par fichier, outils de test (en anglais) |
| [`docs/choix-techniques.md`](docs/choix-techniques.md) | Chaque décision technique et sa raison |
| [`docs/protocol.md`](docs/protocol.md) | Messages entre la page et le boîtier, format des fichiers sur la carte SD (en anglais) |
| `firmware/src/` | Le firmware. Point de départ : `main.cpp`, puis `acquisition.cpp`, `sensors_real.cpp` |
| `webapp/` | La page web (HTML, CSS, JavaScript, sans étape de compilation) |
| `experiments/sensortest/` | Petit programme à part qui affiche les valeurs brutes des trois puces de la carte capteurs |

**Licences.** Le dépôt contient la bibliothèque WebSockets (licence LGPL 2.1, modifiée :
voir `firmware/lib/WebSockets/PATCHED.md`) et uPlot (licence MIT). Leurs fichiers de licence
doivent rester avec le code. Le reste du projet n'a pas encore de licence : à choisir avant
toute publication en dehors de l'équipe.
