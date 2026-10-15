# Breath Logger : choix techniques

État au 15 octobre 2026. Ce document rassemble toutes les décisions techniques du projet,
pour pouvoir les présenter et les rediscuter une par une.

**Format de chaque choix**
- **Décision** : ce qui a été retenu.
- **Pourquoi** : les raisons.
- **Écarté** : les alternatives considérées, et pourquoi on ne les a pas prises.
- **Conséquences** : ce que ça implique, les limites.
- **Statut** : ✅ validé sur la vraie carte · 🧪 testé en simulation (mode démo ou capteurs
  simulés) · 📝 écrit, pas encore testé · ⏳ décision encore ouverte.

Les détails précis (messages échangés, format des fichiers) sont dans `docs/protocol.md`.
Un glossaire des termes techniques est à la fin.

---

## Sommaire

1. [Contexte et exigences](#1-contexte-et-exigences)
2. [Vue d'ensemble](#2-vue-densemble)
3. [Matériel](#3-matériel) : C1 à C5
4. [Firmware](#4-firmware) : C6 à C12
5. [Stockage et format des fichiers](#5-stockage-et-format-des-fichiers) : C13 à C17
6. [Communication carte ↔ PC](#6-communication-carte--pc) : C18 à C24
7. [Application PC](#7-application-pc) : C25 à C31
8. [Outils et méthode de travail](#8-outils-et-méthode-de-travail) : C32 à C34
9. [Décisions encore ouvertes](#9-décisions-encore-ouvertes)
10. [Chiffres clés](#10-chiffres-clés)
11. [Glossaire](#11-glossaire)

---

## 1. Contexte et exigences

- **Usage** : mesurer la respiration d'athlètes à l'effort (tapis de course pour l'instant,
  terrain plus tard), sur de vraies personnes.
- **Signaux** : 4 voies : CO₂ (%), O₂ (%), débit d'air (L/min), pression (cmH₂O). Pour
  l'instant, on garde uniquement les signaux bruts, sans calcul (pas de VO₂, pas de
  volumes).
- **Fréquence visée** : 50 mesures par seconde (50 Hz), sans être une exigence stricte.
- **Autonomie** : l'appareil doit enregistrer seul, même si le PC ou le câble est débranché.
- **Sans internet** : tout doit marcher hors ligne.
- **Récupération des données** : avant tout en sortant la carte SD. L'appli doit quand même
  lister, afficher et modifier les enregistrements.
- **Évolutions prévues** : horloge interne (RTC), LED d'état de la respiration, boutons sur
  l'appareil, peut-être Wi-Fi.

## 2. Vue d'ensemble

```
 Capteurs ──I2C──> ESP32-S3 (XIAO) ──SPI──> carte SD  (fichiers CSV + meta.json)
                        │
                        └──USB──> PC Windows : Chrome / Edge
                                  page web locale (Web Serial)
                                  - direct : 4 courbes
                                  - enregistrements : liste, lecture, export CSV

 Dans l'ESP32 :
 cœur 1  tâche acquisition : toutes les 20 ms, lit les capteurs et horodate
              ├──> file "enregistrement" (10 s) ──> écriture SD
              └──> file "direct" ──> USB vers la page
 cœur 0  tâche E/S : écriture SD (vidée chaque seconde), commandes USB, état toutes les 0,5 s
```

---

## 3. Matériel

### C1 · Carte Seeed XIAO ESP32-S3 sur notre circuit imprimé

- **Décision** : microcontrôleur ESP32-S3 sous forme de module XIAO (8 Mo de mémoire
  flash, 8 Mo de PSRAM), soudé sur le circuit imprimé de l'équipe.
- **Pourquoi** :
  - deux cœurs, ce qui permet de séparer la mesure du reste ;
  - USB intégré, sans puce USB-série en plus ;
  - Wi-Fi et Bluetooth disponibles pour plus tard ;
  - module très petit, peu cher, et bien pris en charge par Arduino.
- **Écarté** : la carte de développement ESP32-S3-DevKitC, prévue au départ (trop grosse
  pour le boîtier).
- **Conséquences** :
  - les autres broches du XIAO ne sont pas encore connues : il faut le schéma avant de
    les utiliser ;
  - le fichier de configuration PlatformIO garde le profil « DevKitC » : sans effet sur
    le fonctionnement ;
  - la section « Flash the device » du README décrit encore la DevKitC et PlatformIO. Elle
    est à mettre à jour (on flashe aujourd'hui avec `flash.bat`).
- **Statut** : ✅ la carte tourne avec le firmware.

### C2 · Carte SD branchée en SPI

- **Décision** : le lecteur SD est câblé en mode SPI sur les broches SPI du XIAO
  (CS = GPIO44/D7, SCK = 7, MISO = 8, MOSI = 9), à 20 MHz.
- **Pourquoi** : c'est le câblage du circuit imprimé. Les broches ont été trouvées avec nos
  outils `pinprobe` (lecture passive des broches) et `sdprobe` (essai de la carte sur
  chaque broche CS possible).
- **Écarté** : le mode SDMMC, plus rapide (1 ou 4 lignes de données). Il est déjà prévu dans
  le code (`SD_USE_SDMMC`) pour un futur circuit imprimé.
- **Conséquences** : le débit SPI suffit très largement (on écrit environ 2 Ko/s).
- **Statut** : ✅ carte détectée, enregistrement et relecture validés (`devtest.py`).

### C3 · Système de fichiers FAT32

- **Décision** : la carte doit être formatée en FAT32.
- **Pourquoi** : c'est le format que la bibliothèque SD d'Arduino lit à coup sûr, et que tous
  les PC lisent.
- **Écarté** : l'exFAT. Les cartes de 64 Go et plus sont vendues formatées en exFAT, et notre
  version du firmware ne le lit pas.
- **Conséquences** :
  - une carte neuve de 64 Go doit être reformatée (par exemple avec Rufus) : impossible à
    demander à un client ;
  - un fichier ne peut pas dépasser 4 Go, soit environ 600 heures d'une seule session à
    50 Hz.
- **Statut** : ✅ (SanDisk Ultra 64 Go reformatée). ⏳ Pour les clients : livrer la carte
  formatée, ou vérifier si le firmware peut lire l'exFAT.

### C4 · Horloge : c'est le PC qui donne l'heure

- **Décision** : pas de puce horloge (RTC) pour l'instant. À la connexion, la page envoie
  l'heure du PC à la carte.
- **Pourquoi** : une pièce de moins. Tant qu'on enregistre avec le PC branché, les fichiers
  ont la bonne date.
- **Écarté** : une puce RTC dès maintenant. Elle reste prévue pour plus tard.
- **Conséquences** :
  - sans connexion préalable, une session n'a pas de vraie date (marquée `"clock": false`) ;
  - on ne peut pas « continuer » une session si l'horloge n'est pas réglée.
- **Statut** : ✅. ⏳ RTC à ajouter si l'appareil doit enregistrer seul.

### C5 · Capteurs simulés en attendant les vrais

- **Décision** : le firmware produit des signaux de respiration réalistes (athlète sur tapis)
  tant que les capteurs ne sont pas choisis (`USE_SIMULATED_SENSORS 1`). Les vrais pilotes
  iront dans `sensors_real.cpp`, sur le bus I2C (GPIO 5 et 6, résistances de rappel
  externes).
- **Pourquoi** : on peut développer et tester toute la chaîne (mesure, SD, USB, affichage)
  sans attendre les capteurs.
- **Conséquences** :
  - les courbes affichées ne sont pas de vraies mesures. L'appli le signale par un bandeau
    jaune et une étiquette « Simulé » sur chaque signal ;
  - les enregistrements faits ainsi sont indiscernables des vrais sur la carte SD (voir
    décisions ouvertes) ;
  - les capteurs lents (par exemple un CO₂ à 10 Hz) devront être lus seulement quand ils ont
    une nouvelle valeur, en répétant la dernière entre deux.
- **Statut** : ✅ simulation. ⏳ Choix des capteurs (modèles, interfaces, unités, temps de
  réponse).

---

## 4. Firmware

### C6 · PlatformIO + Arduino (cœur 2.0.17)

- **Décision** : firmware en C++ avec le cadre Arduino pour ESP32 (paquet `espressif32`
  7.x, cœur Arduino 2.0.17), compilé avec PlatformIO.
- **Pourquoi** :
  - l'équipe connaît Arduino ;
  - FreeRTOS (le système multitâche de l'ESP32) reste accessible quand on en a besoin.
- **Écarté** : ESP-IDF, l'environnement natif d'Espressif. Plus puissant, mais plus difficile
  à prendre en main.
- **Conséquences** : le pilote USB d'Arduino 2.0.17 perdait des octets à l'envoi. On a écrit
  notre propre envoi (C21).
- **Statut** : ✅.

### C7 · Deux tâches, une par cœur

- **Décision** :
  - **cœur 1** : une tâche « acquisition » seule, à haute priorité. Elle se réveille
    exactement toutes les 20 ms (`vTaskDelayUntil`), lit les capteurs, horodate la mesure
    et la dépose dans deux files ;
  - **cœur 0** : une tâche « E/S » qui écrit sur la SD, parle avec le PC et envoie l'état.
- **Pourquoi** : une écriture sur carte SD peut bloquer 100 à 500 ms. Si elle se faisait dans
  la même tâche que la mesure, on raterait des mesures. Ici, la mesure ne dépend jamais de
  la SD ni de l'USB.
- **Écarté** : une seule boucle `loop()` Arduino. Plus simple, mais la régularité de la mesure
  dépendrait du reste.
- **Conséquences** : un tour de la tâche E/S dure au plus 5 ms (mesuré). Une surveillance
  signale si la mesure s'arrête plus d'1 s (`acq_ok`, événement « stall »).
- **Statut** : ✅ 50,0 Hz exacts mesurés sur 300 s, aucun trou.

### C8 · 50 mesures par seconde

- **Décision** : `SAMPLE_RATE_HZ 50`. On peut le changer : la valeur doit diviser 1000 (50,
  100, 125, 200, 250…).
- **Pourquoi** :
  - suffisant pour des respirations rapides (même à 60 respirations/min, on a 50 points par
    respiration) ;
  - le volume de données reste faible.
- **Conséquences** : 100 Hz reste possible sans rien changer d'autre. Mais à 50 Hz, la limite
  sera plutôt le temps de réponse des capteurs de gaz que la fréquence.
- **Statut** : ✅. ⏳ À revoir avec les capteurs réels.

### C9 · Files tampon entre la mesure et le reste

- **Décision** :
  - une file « enregistrement » de 512 mesures, soit environ 10 s : elle absorbe les
    lenteurs de la carte SD ;
  - une file « direct » de 64 mesures : si le PC ne suit pas, on jette les plus anciennes,
    ce qui n'a aucune conséquence pour l'enregistrement.
- **Pourquoi** : une mesure ne doit jamais attendre. Seul l'affichage peut perdre des points,
  l'enregistrement jamais.
- **Conséquences** : le compteur « Échantillons perdus » (`dropped`) de la page doit rester
  à 0. S'il ne l'est pas, un événement « lost » est noté dans le fichier, à l'endroit exact.
- **Statut** : ✅ 0 perte au test sur la carte.

### C10 · L'appareil est le maître

- **Décision** : c'est la carte qui enregistre. Le PC ne fait que regarder et commander. Si
  le câble ou le navigateur se débranche, l'enregistrement continue. À la reconnexion, la page
  retrouve l'enregistrement en cours. Ouvrir le port ne redémarre pas la carte : les signaux
  DTR et RTS sont maintenus bas.
- **Pourquoi** : sur le terrain, un câble qui se débranche ne doit pas faire perdre une
  séance.
- **Écarté** : un PC qui enregistrerait les données reçues. C'est fragile, et ça imposerait de
  rester branché.
- **Statut** : 📝 à valider sur la carte (lancer un enregistrement, fermer la page, la
  rouvrir).

### C11 · Robustesse face aux coupures et aux erreurs

- **Décision** :
  - données forcées sur la carte toutes les 1 s : en cas de coupure, on perd au plus ~1 s ;
  - `meta.json` écrit d'abord dans un fichier temporaire (`meta.tmp`) puis renommé, pour ne
    jamais laisser un fichier à moitié écrit ;
  - totaux des sessions sauvegardés toutes les 30 s ;
  - une session sans événement « stop » est affichée comme *interrompue* ;
  - valeurs aberrantes (non finies, ou au-delà de ±100 000) : cellule vide plutôt que
    fausse ;
  - une voie sans valeur valide pendant 1 s est signalée « Pas de signal » ;
  - si l'écriture SD échoue, l'enregistrement s'arrête proprement et la page affiche
    l'erreur.
- **Pourquoi** : une séance avec un athlète ne se refait pas facilement. Mieux vaut un fichier
  incomplet mais valide qu'un fichier corrompu.
- **Statut** : 📝 tests de coupure de courant et de retrait de la carte SD à faire.

### C12 · On n'efface jamais rien directement

- **Décision** :
  - « Supprimer » déplace les fichiers dans `/trash` sur la carte. On peut les récupérer en
    lisant la carte sur un PC. « Vider la corbeille » efface pour de bon ;
  - « Rogner » (garder une partie d'une session) ne modifie pas le fichier CSV : le rognage
    est noté dans `meta.json` et l'appli cache les lignes. « Tout afficher » annule les
    rognages, et l'historique des modifications est conservé.
- **Pourquoi** : les données brutes d'un athlète sont précieuses, et une erreur de
  manipulation ne doit pas les détruire.
- **Conséquences** : rogner ne libère pas de place. Quelqu'un qui lit la carte directement
  doit appliquer les rognages lui-même (règle dans `protocol.md`).
- **Statut** : 🧪 testé en mode démo.

---

## 5. Stockage et format des fichiers

### C13 · Un dossier par enregistrement, un CSV par session

- **Décision** :
  ```
  /recordings/<nom>/meta.json
  /recordings/<nom>/session_001.csv
  /recordings/<nom>/session_002.csv
  ```
  Un enregistrement correspond par exemple à un athlète ou à un protocole. Une session est un
  passage (un test).
- **Pourquoi** :
  - lisible directement en sortant la carte SD ;
  - un fichier par session reste de taille raisonnable ;
  - `meta.json` décrit tout (dates, notes, pauses, rognages).
- **Écarté** :
  - un seul gros fichier (difficile à lire et à manipuler) ;
  - un format binaire (plus compact, mais illisible sans notre logiciel).
- **Statut** : ✅.

### C14 · CSV en texte simple

- **Décision** : colonnes `t_s,co2_pct,o2_pct,flow_lpm,pressure_cmh2o`. `t_s` est en secondes
  depuis le **premier départ** de la session. Une valeur manquante est une cellule vide.
- **Pourquoi** : s'ouvre dans Excel, Python, R, MATLAB, sans conversion.
- **Conséquences** :
  - environ 6,7 Mo par heure à 50 Hz ;
  - l'export depuis l'appli peut ajouter une colonne date/heure lisible par un tableur.
- **Statut** : ✅.

### C15 · Pause = même session, avec un trou

- **Décision** : une pause ne crée pas de nouvelle session. On arrête simplement d'écrire, et
  des événements `pause` et `resume` sont notés dans `meta.json`. Dans le CSV, la pause
  apparaît comme un trou dans le temps.
- **Pourquoi** : un test avec une pause reste un seul test. L'appli resserre les pauses à
  l'affichage et les marque d'un repère.
- **Statut** : ✅ validé par `devtest.py` (enregistrement avec pause relu sans perte).

### C16 · « Continuer » une session existante

- **Décision** : on peut reprendre une session déjà arrêtée, même le lendemain. Les nouvelles
  lignes s'ajoutent à la fin du même CSV. Le temps continue de compter depuis le départ
  d'origine, et la date de chaque reprise est notée.
- **Pourquoi** : c'était une demande explicite (un protocole en plusieurs parties).
- **Conséquences** : nécessite que l'horloge soit réglée, sinon les temps seraient faux.
- **Statut** : 🧪 testé en mode démo.

### C17 · Ce qui limite la capacité

- **Décision / constat** : la mémoire de l'ESP32 ne limite ni la durée d'enregistrement
  (seuls 10 s sont en mémoire), ni le nombre d'enregistrements (la liste est envoyée un
  élément à la fois).
- **Conséquences** :
  - le `meta.json` d'un enregistrement est chargé en mémoire : rester sous ~100 sessions
    par enregistrement ;
  - une carte de 8 Go contient environ 1 200 heures à 50 Hz.
- **Statut** : ✅ calculé.

---

## 6. Communication carte ↔ PC

### C18 · Câble USB d'abord

- **Décision** : liaison par câble USB. Le Wi-Fi est peut-être pour plus tard.
- **Pourquoi** :
  - fiable, rien à configurer, et l'appareil est alimenté par le câble ;
  - suffisant sur tapis de course.
- **Écarté pour l'instant** :
  - le Wi-Fi (le PC perdrait internet en se connectant au réseau de l'appareil) ;
  - le Bluetooth (choix des analyseurs portables du marché, comme VO2 Master ou PNOE, mais
    plus de travail).
- **Statut** : ✅. ⏳ Sans fil à reconsidérer pour le terrain.

### C19 · L'USB intégré de l'ESP32-S3 (« USB Serial/JTAG »)

- **Décision** : on utilise le port USB intégré à la puce, en mode port série.
- **Pourquoi** :
  - pas de puce supplémentaire ;
  - Windows 10 et 11 installent le pilote tout seuls ;
  - le même port sert à flasher le firmware.
- **Conséquences** :
  - le port s'appelle « USB JTAG/serial debug unit » et porte l'identifiant `303A:1001`,
    commun à **toutes** les cartes ESP32-S3. Le nom « Breath Logger » n'apparaît nulle part ;
  - pour changer ce nom, il faudrait passer à une autre pile USB (TinyUSB). On perdrait alors
    le passage automatique en mode flash.
- **Statut** : ✅.

### C20 · Protocole : du JSON, un message par ligne

- **Décision** :
  - chaque message est un objet JSON sur une ligne ;
  - le PC envoie des commandes numérotées, et la carte répond une fois à chacune avec le
    même numéro ;
  - les données en direct arrivent par paquets de 5 mesures, soit 10 messages par seconde ;
  - l'état (enregistrement, carte SD, horloge, pertes…) arrive 2 fois par seconde ;
  - la liste des enregistrements est envoyée un élément à la fois.
- **Pourquoi** :
  - lisible par un humain, donc facile à déboguer ;
  - le même format sert au firmware, à la page et aux outils Python.
- **Écarté** : un protocole binaire. Plus compact, mais inutile : on utilise 0,25 % de la
  capacité de l'USB.
- **Conséquences** : environ 2,5 Ko/s en direct.
- **Statut** : ✅.

### C21 · Envoi USB géré par notre code (`link.cpp`)

- **Décision** : le firmware garde ses propres messages en attente (16 Ko) et remplit lui-même
  le petit tampon matériel de l'USB, au lieu de passer par `Serial.write()` d'Arduino.
- **Pourquoi** : mesuré sur la carte : le pilote Arduino 2.0.17 perdait des octets (environ
  1 bloc de fichier abîmé sur 25).
- **Conséquences** :
  - si le PC ne lit plus pendant 1 s (page fermée), la carte jette les messages en attente
    au lieu de bloquer ;
  - les réponses aux commandes attendent au plus 0,5 s d'être envoyées.
- **Statut** : ✅.

### C22 · Paquets USB de 63 octets au plus

- **Décision** : la carte n'envoie jamais un paquet USB plein (64 octets).
- **Pourquoi** : Windows garde pour lui les paquets pleins de 64 octets jusqu'à ce qu'un paquet
  plus court arrive. Résultat : l'affichage se figeait environ 0,5 s toutes les 3 s, puis
  rattrapait d'un coup. Démarche suivie :
  1. analyse image par image de la vidéo d'écran ;
  2. mesure avec `jitter.py` : la carte envoyait à l'heure, mais le PC recevait en retard et
     par paquets, dans Python comme dans Chrome ;
  3. correction, puis nouvelle mesure.
- **Résultat mesuré** : 102 trous de plus de 150 ms en 2 minutes avant, **0 en 5 minutes
  après**. Retard maximum : 498 ms avant, 32 ms après.
- **Conséquences** : toute future modification de l'envoi USB doit garder cette règle
  (commentaire dans `link.cpp`).
- **Statut** : ✅.

### C23 · Lecture des fichiers par morceaux contrôlés

- **Décision** : la page lit un fichier par morceaux de 4 Ko, 3 à la fois. Chaque morceau porte
  sa longueur et un CRC-32 (une empreinte). S'il est abîmé, la page le redemande.
- **Pourquoi** :
  - un fichier faux sans qu'on le sache serait pire qu'une erreur ;
  - c'est la page qui demande le morceau suivant, donc l'ESP32 n'a jamais besoin de tout le
    fichier en mémoire.
- **Conséquences** :
  - environ 65 Ko/s, soit 1 min 40 s pour une heure enregistrée ;
  - pour des sessions de plusieurs heures, lire directement la carte SD est plus rapide.
- **Statut** : ✅ validé par `devtest.py`.

### C24 · Diagnostic intégré

- **Décision** : trois outils restent dans le produit :
  - l'état envoyé par la carte contient des compteurs de diagnostic (`diag`) ;
  - `tools/jitter.py` mesure l'heure d'arrivée des données sans navigateur ;
  - la page ouverte avec `?debug` affiche un panneau de mesures et permet de télécharger un
    journal.
- **Pourquoi** : c'est ce qui a permis de trouver la cause des à-coups. Ce sera utile pour les
  vrais capteurs et pour le support client.
- **Statut** : ✅.

---

## 7. Application PC

### C25 · Une page web locale, dans Chrome ou Edge

- **Décision** :
  - l'appli est une page web (`webapp/index.html`) ouverte dans Chrome ou Edge ;
  - elle parle à la carte par l'API Web Serial ;
  - aucun serveur ni internet nécessaire ;
  - aucune étape de compilation : HTML, CSS et JavaScript simples ;
  - la bibliothèque de graphiques uPlot et la police Inter sont incluses dans le dossier.
- **Pourquoi** :
  - rien à installer ;
  - une seule base de code pour Windows et Mac ;
  - facile à modifier.
- **Écarté pour l'instant** :
  - une application de bureau type Electron (installateur d'environ 100 Mo, alerte Windows
    « éditeur inconnu » sans certificat payant, mises à jour à gérer) ;
  - une appli mobile.
- **Conséquences** :
  - ne marche pas dans Firefox ni Safari, ni sur iPhone/iPad ;
  - la première connexion passe par la fenêtre « choisir un port » du navigateur.
- **Statut** : ✅.

### C26 · Affichage en direct style moniteur

- **Décision** :
  - 4 courbes empilées qui partagent l'axe du temps, chacune avec sa valeur en gros et le
    min/max de la fenêtre ;
  - fenêtre de 10, 30 ou 60 s ;
  - échelles verticales qui ne font que s'agrandir, pour que l'image ne saute pas.
- **Décision (fluidité)** :
  - défilement continu, redessiné à chaque image de l'écran (60 par seconde) ;
  - un **retard fixe de 0,2 s**, pour que les données arrivées par paquets de 100 ms soient
    toujours là quand le défilement les atteint ;
  - la grille reste fixe (−30 s … −2 s) et les courbes glissent dessous.
- **Pourquoi** : avant, la courbe avançait par petits sauts 10 fois par seconde.
- **Décision (souris)** : quand la souris est sur les courbes, les gros chiffres montrent la
  valeur sous la souris. Ils passent alors en gris, avec l'étiquette « Curseur » et « il y a
  X s ». Sans ce repère, on risquait de prendre une ancienne valeur pour la valeur actuelle.
- **Statut** : 🧪 testé en mode démo. ✅ fluidité confirmée à l'œil sur la carte.

### C27 · Mode démo masqué, signaux simulés signalés

- **Décision** :
  - le mode démo (un faux appareil simulé dans la page) n'apparaît plus. Il reste accessible
    avec `index.html?demo`, pour les tests et les présentations ;
  - dès que les signaux sont simulés (mode démo ou firmware sans vrais capteurs), un bandeau
    jaune et une étiquette « Simulé » sur chaque signal le disent.
- **Pourquoi** :
  - la vraie carte fonctionne, donc le mode démo n'a plus à être mis en avant ;
  - des courbes simulées ne doivent jamais passer pour de vraies mesures.
- **Statut** : 🧪 testé en mode démo. 📝 à vérifier avec la carte.

### C28 · Gestion des enregistrements dans l'appli

- **Décision** :
  - liste groupée par date, avec recherche ;
  - notes, renommage, suppression (vers la corbeille) ;
  - sessions avec leurs parties (premier passage, reprises, pauses) ; sessions interrompues
    signalées ;
  - visualisation avec zoom, axe en temps enregistré ou en heure réelle, et repères de pause
    et de reprise ;
  - rognage non destructif ;
  - export CSV avec, en option, une colonne date/heure ;
  - français et anglais, thème clair ou sombre.
- **Pourquoi** : la carte SD reste la voie principale, mais on doit pouvoir tout gérer sans
  ouvrir le boîtier.
- **Statut** : 🧪 testé en mode démo. 📝 à repasser sur la carte.

### C29 · Ouverture par un raccourci « application »

- **Décision** : `launcher/Creer le raccourci.bat` crée un raccourci **Breath Logger**, avec
  son icône, sur le Bureau et dans le menu Démarrer. Le raccourci ouvre la page dans une
  fenêtre Chrome à part, sans onglets ni barre d'adresse (option `--app`), ou dans Edge si
  Chrome est absent.
- **Pourquoi** : avant, il fallait glisser `index.html` dans le navigateur.
- **Écarté** :
  - le lancement automatique au branchement par Windows : fragile, à configurer sur chaque
    PC. Garmin le fait et ses utilisateurs s'en plaignent ;
  - l'avertissement « branchez → ouvrez cette page » (WebUSB) : désactivé par Chrome sous
    Windows.
- **Statut** : ✅ raccourcis créés sur le PC de développement.

### C30 · Démarrage : l'appli attend la carte (choix de principe)

- **Décision de principe** : comme les appareils du marché, on ne cherche pas à « lancer l'appli
  quand on branche ». On veut une appli à un clic, ou déjà ouverte, qui trouve la carte toute
  seule.
- **Revue du marché** :
  - logiciels PC du fabricant (COSMED, Cortex, MIR) ;
  - applis tablette en Bluetooth (VO2 Master, PNOE) ;
  - appareils qui servent leur propre page web (BeagleBone) ;
  - appareils vus comme une clé USB (enregistreurs Elitech) ;
  - applis web en USB (micro:bit).
- **Statut** : ⏳ prochaines étapes dans la section 9.

### C31 · Le parcours client (constat)

- **Constat** : aujourd'hui, un client sur un PC neuf devrait :
  1. récupérer et décompresser le dossier ;
  2. passer outre l'alerte Windows sur le `.bat` ;
  3. deviner que le port « USB JTAG/serial debug unit » est l'appareil ;
  4. reformater sa carte SD si elle fait 64 Go ou plus ;
  5. utiliser `flash.bat` pour les mises à jour du firmware.
- **Cible proposée** : 3 gestes : installer l'appli (QR code sur l'appareil), brancher, cliquer
  sur Connecter une seule fois.
- **Statut** : ⏳ voir section 9.

---

## 8. Outils et méthode de travail

### C32 · Environnement de développement

- **Décision** :
  - le code est écrit et compilé dans WSL (Linux sous Windows) ;
  - comme WSL ne voit pas l'USB, la carte est flashée depuis Windows avec `flash.bat`
    (`esptool.exe`) ;
  - les fichiers sont recopiés dans `C:\Users\vince\BreathLogger` ;
  - un Python portable y est inclus pour les outils de test.
- **Conséquences** : penser à recopier après chaque modification. `flash.bat` n'est pas encore
  dans Git.
- **Statut** : ✅.

### C33 · Outils de test

| Outil | Rôle |
|---|---|
| `tools/devtest.py` | Test complet sans navigateur : débit en direct, enregistrement avec pause, relecture du fichier avec contrôle CRC, aucune ligne manquante. |
| `tools/jitter.py` | Heure d'arrivée de chaque paquet sur le PC, trous, retards, compteurs de la carte. Résultats bruts en CSV. |
| `index.html?debug` | Le même diagnostic vu depuis Chrome, plus les images lentes de la page. |
| `tools/pinprobe` | Firmware de test : lit l'état de chaque broche sans rien piloter. |
| `tools/sdprobe` | Firmware de test : cherche sur quelle broche répond la carte SD. |

- **Statut** : ✅.

### C34 · Méthode : mesurer avant de corriger, et garder l'historique

- **Décision** :
  - chaque problème est d'abord mesuré, avec des critères de réussite chiffrés (par exemple
    « aucun trou de plus de 150 ms pendant 5 minutes ») ;
  - le projet est sous Git depuis le 15 octobre 2026, avec un commit par étape. On peut
    revenir à n'importe quelle version.
- **Pourquoi** : la réduction des données ou du code, envisagée au départ contre les à-coups,
  n'aurait rien réglé. La mesure a montré que la cause était ailleurs.
- **Statut** : ✅.

---

## 9. Décisions encore ouvertes

| # | Sujet | Options | Proposition |
|---|---|---|---|
| O1 | **Capteurs** | Modèles, interfaces (I2C ou autre), unités, temps de réponse | Choisir en priorité le temps de réponse du CO₂ et de l'O₂, et prévoir le recalage dans le temps entre gaz et débit. |
| O2 | **Alimentation** | Câble USB seul, ou batterie | À décider avec l'usage terrain. |
| O3 | **Horloge RTC** | Sans (le PC donne l'heure), ou avec une puce | Nécessaire si l'appareil enregistre seul, sans PC. |
| O4 | **Connexion automatique** | Garder « Connecter + choisir le port », ou se connecter seul à l'ouverture et après un débranchement | Se connecter seul, et ne montrer que l'appareil dans la liste des ports. Peu de travail, gros gain. |
| O5 | **Distribution aux clients** | A. appli web hébergée et installable (sans alerte Windows, mises à jour automatiques) · B. installateur `.exe` · C. appareil vu comme une clé USB | A. Questions : peut-on mettre l'appli en ligne ? Sur quel domaine ? |
| O6 | **Mise à jour du firmware chez le client** | `flash.bat` (outil de développeur), ou mise à jour depuis l'appli dans le navigateur | Depuis l'appli. |
| O7 | **Cartes SD des clients** | Carte fournie déjà formatée, ou firmware qui lit l'exFAT | Fournir la carte. Vérifier la faisabilité de l'exFAT. |
| O8 | **Sessions simulées sur la SD** | Rien, ou une mention « simulé » dans `meta.json` et une étiquette dans la liste | Ajouter la mention (petit changement, reflash nécessaire). |
| O9 | **Sans fil** | Bluetooth depuis la même page web, Wi-Fi, ou rester en câble | À décider selon le terrain : un câble entre l'athlète et le PC est-il acceptable ? |
| O10 | **Nom USB « Breath Logger »** | Garder l'USB intégré, ou passer à la pile TinyUSB | Garder pour l'instant (on perdrait le flash facile). |
| O11 | **Sécurité électrique** | PC sur secteur relié à un athlète | Isolateur USB, ou PC sur batterie pendant les tests. |
| O12 | **Cadre réglementaire et données** | Usage sportif ou médical | Médical : règlement européen sur les dispositifs médicaux (MDR). Sportif : marquage CE et RGPD. Le fait que les données restent sur le PC est un atout. |
| O13 | **Tests de robustesse** | Coupure de courant, retrait de la carte SD, plusieurs heures | À faire sur la carte. `devtest.py --seconds 3600` pour l'endurance. |

---

## 10. Chiffres clés

| Mesure | Valeur | Source |
|---|---|---|
| Fréquence de mesure | 50,0 Hz, 0 trou sur 300 s | `jitter.py`, carte réelle |
| Débit USB en direct | ~2,5 Ko/s (0,25 % de la capacité USB) | calcul |
| Retard d'arrivée des données (après correction) | médiane 12 ms, max 32 ms | `jitter.py` |
| Trous de plus de 150 ms | 102 en 2 min avant → 0 en 5 min après | `jitter.py` |
| Retard d'affichage voulu | 0,2 s | choix (C26) |
| Tampon d'enregistrement | ~10 s (512 mesures) | `config.h` |
| Données perdues au pire en coupure de courant | ~1 s | `config.h` (FLUSH_PERIOD_MS) |
| Volume des fichiers | ~6,7 Mo/heure à 50 Hz | calcul |
| Carte de 8 Go | ~1 200 heures | calcul |
| Plus longue session possible (limite FAT32 de 4 Go) | ~600 heures | calcul |
| Lecture d'un fichier par USB | ~65 Ko/s (1 min 40 s par heure enregistrée) | mesuré |
| Tour de la boucle E/S | 5 ms au plus | `jitter.py` (diag) |

---

## 11. Glossaire

- **ESP32-S3** : le microcontrôleur, le « cerveau » de l'appareil. Il a deux cœurs, qui peuvent
  faire deux choses en même temps.
- **Firmware** : le programme qui tourne dans l'appareil.
- **FreeRTOS, tâche** : le petit système de l'ESP32 qui fait tourner plusieurs programmes
  (tâches) en parallèle, avec des priorités.
- **File tampon (queue)** : une salle d'attente pour les données, entre celui qui les produit et
  celui qui les utilise.
- **SPI, I2C** : deux façons de relier des puces entre elles (SPI pour la carte SD, I2C pour les
  capteurs).
- **FAT32, exFAT** : deux formats de carte mémoire. FAT32 est le plus universel, mais limité à
  4 Go par fichier.
- **CSV** : un tableau en texte, une ligne par mesure, des valeurs séparées par des virgules.
- **JSON** : un format texte pour les messages, lisible par un humain.
- **USB Serial/JTAG** : le port USB intégré à l'ESP32-S3, vu par le PC comme un port série (COM).
- **Paquet USB** : l'USB transporte les données par petits paquets de 64 octets au plus.
- **CRC-32** : une empreinte calculée sur un bloc de données. Si un seul octet change, l'empreinte
  change : on détecte ainsi les transferts abîmés.
- **Web Serial** : la fonction de Chrome et d'Edge qui permet à une page web de parler à un port
  série, avec l'accord de l'utilisateur.
- **Mode `--app` de Chrome** : ouvre une page dans sa propre fenêtre, sans onglets ni barre
  d'adresse, comme un programme.
- **Appli web installable (PWA)** : une page web qu'on installe depuis le navigateur. Elle a son
  icône, sa fenêtre, et marche hors ligne.
- **RTC** : une puce horloge avec une pile, qui garde l'heure même éteinte.
- **Gigue (jitter)** : l'irrégularité des délais d'arrivée des données.
