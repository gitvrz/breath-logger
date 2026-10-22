# Breath Logger : choix techniques

État au 22 octobre 2026. Ce document rassemble toutes les décisions techniques du projet,
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
3. [Matériel](#3-matériel) : C1 à C5, C45 à C48
4. [Firmware](#4-firmware) : C6 à C12
5. [Stockage et format des fichiers](#5-stockage-et-format-des-fichiers) : C13 à C17
6. [Communication carte ↔ PC](#6-communication-carte--pc) : C18 à C24
7. [Application PC](#7-application-pc) : C25 à C31
8. [Outils et méthode de travail](#8-outils-et-méthode-de-travail) : C32 à C34
9. [Wi-Fi et mise à jour du firmware](#9-wi-fi-et-mise-à-jour-du-firmware) : C35 à C44
10. [Décisions encore ouvertes](#10-décisions-encore-ouvertes)
11. [Chiffres clés](#11-chiffres-clés)
12. [Glossaire](#12-glossaire)

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
- **Évolutions prévues** : LED d'état de la respiration, boutons sur l'appareil. Le Wi-Fi
  (section 9) et l'horloge interne (C4) sont faits.

## 2. Vue d'ensemble

```
 Capteurs ──I2C──> ESP32-S3 (XIAO) ──SPI──> carte SD  (fichiers CSV + meta.json)
                        │
                        ├──USB──> PC Windows : Chrome / Edge
                        │         page web locale (Web Serial)
                        │         - direct : 4 courbes
                        │         - enregistrements : liste, lecture, export CSV
                        │         - mise à jour du firmware
                        │
                        └──Wi-Fi (réseau BreathLogger-XXXX créé par l'appareil)──>
                                  PC, tablette, téléphone : la même page, servie par
                                  l'appareil (http://192.168.4.1), jusqu'à 4 écrans

 Dans l'ESP32 :
 cœur 1  tâche acquisition : toutes les 20 ms, lit les capteurs et horodate
              ├──> file "enregistrement" (10 s) ──> écriture SD
              └──> file "direct" ──> USB vers la page
 cœur 0  tâche E/S : écriture SD (vidée chaque seconde), commandes USB, état toutes les 0,5 s
         tâche Wi-Fi : page web, WebSocket ; échange avec la tâche E/S par des files
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
  - le README et `docs/development.md` décrivent la XIAO et `flash.bat` (la mention de la
    DevKitC a été retirée le 20 octobre 2026).
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

### C4 · Horloge : une puce DS1307, et le PC pour la mettre à l'heure

- **Décision** : une puce horloge (RTC) DS1307 sur la carte capteurs, avec sa pile. Au
  démarrage, le firmware la lit et connaît l'heure sans PC. Quand une page se connecte, elle
  envoie l'heure du PC : si l'appareil n'a pas d'heure ou a plus d'1 s d'écart, il prend
  celle du PC et la recopie dans la puce. Avant : seul le PC donnait l'heure.
- **Pourquoi** : en cas de perte de connexion ou de redémarrage, l'appareil garde la bonne
  heure et peut continuer une session, même sans page ouverte.
- **Comment** :
  - la puce ne compte que des secondes entières. Au démarrage, le firmware attend le
    changement de seconde (1 s au plus) pour connaître l'heure à la milliseconde, puis le
    compteur de l'ESP32 prend le relais ;
  - l'heure du PC est recopiée dans la puce pile au changement de seconde ;
  - les écarts de moins d'1 s sont ignorés : sinon l'heure bougerait un peu à chaque
    connexion d'un écran ;
  - l'heure est gardée en UTC, sans fuseau horaire.
- **Écarté** : rester sans puce (pas de date sans PC, pas de « continuer » après un
  redémarrage sans PC).
- **Conséquences** :
  - le DS1307 doit être alimenté en **5 V**. En 3,3 V il passe sur sa pile et ne répond plus
    sur le bus. Il ne va qu'à 100 kHz, donc tout le bus I2C tourne à 100 kHz ;
  - la précision est d'environ 1 min par mois, et la puce est remise à l'heure à chaque
    connexion d'un PC ;
  - sans puce (`RTC_ENABLED 0`) ou puce absente, on revient au fonctionnement d'avant.
- **Statut** : 📝 compilé, pas encore testé sur la carte. ⏳ Vérifier l'alimentation 5 V.

### C5 · Capteurs : la pression est réelle, le CO₂ et l'O₂ pas encore

- **Décision** : `USE_SIMULATED_SENSORS 0`. Le capteur de pression LPS28DFW (I2C, GPIO 5
  et 6) donne deux voies : la pression (C45) et le débit (C46). Pas encore de capteur de
  CO₂ ni d'O₂ : ces voies sont simulées à partir de la respiration mesurée (C47).
- **Pourquoi** : tester la chaîne avec une vraie mesure de pression dès que la carte
  capteurs est là.
- **Comment** :
  - le capteur mesure 100 fois par seconde, avec une moyenne sur 16 mesures et un filtre
    passe-bas à 25 Hz. Chaque lecture, toutes les 20 ms, a donc une valeur neuve et lissée ;
  - s'il n'est pas trouvé au démarrage, le firmware le recherche toutes les 2 s ;
  - avec `SIM_GAS 0`, les voies sans capteur sont annoncées à la page (`fitted: false`).
    Elle les affiche « Pas de capteur », et elles ne déclenchent pas d'alerte.
- **Conséquences** :
  - `USE_SIMULATED_SENSORS 1` remet la simulation complète, pour une démonstration sans
    carte capteurs ;
  - la carte capteurs a aussi un accéléromètre et un gyroscope (LSM6DSM), pas utilisés pour
    l'instant. `experiments/sensortest/` les lit tous à part, pour un test rapide.
- **Statut** : 📝 compilé, pas encore testé sur la carte. ⏳ Capteurs de CO₂ et d'O₂.

### C45 · Pression = écart à la pression atmosphérique moyenne

- **Décision** : la voie pression (cmH₂O) est la pression mesurée moins la pression
  atmosphérique. Celle-ci est la moyenne de la pression mesurée sur une longue durée
  (`PRESSURE_BASELINE_S`, 60 s) : la moyenne simple au début, puis une moyenne glissante.
- **Pourquoi** : le capteur mesure une pression absolue (environ 1 013 hPa). Les variations
  dues à la respiration ne sont que de quelques cmH₂O. La moyenne longue suit la météo et
  l'altitude, mais pas les respirations.
- **Conséquences** :
  - la pression atmosphérique utilisée est affichée dans la page et notée au début de
    chaque session (`p_atm_hpa`) ;
  - pendant la première minute après la mise sous tension, la référence se forme encore.
- **Statut** : 📝 compilé, pas encore testé sur la carte.

### C46 · Débit = coefficient × pression, réglé dans `config.h`

- **Décision** : débit (L/min) = coefficient × pression (cmH₂O). Le coefficient est négatif.
  Il se règle dans `config.h` (`FLOW_COEF`), puis on recompile. Pour l'instant −1000, pas
  encore étalonné. À partir d'environ −67, la courbe de débit est au moins aussi haute que
  celle de pression sur la page (axes de ±200 L/min et ±3 cmH₂O, rapport 200/3).
- **Pourquoi** : un seul endroit, visible dans le code et dans l'historique Git.
- **Écarté** : le régler depuis la page et le garder dans l'appareil. Plus souple pour
  étalonner, mais plus de code, et une valeur qu'on ne voit pas dans le dépôt.
- **Conséquences** :
  - changer le coefficient demande une mise à jour du firmware (depuis la page, ~30 s) ;
  - il est noté dans les événements `start` et `continue` de chaque session (`flow_coef`).
    Comme la pression est aussi enregistrée, on peut recalculer le débit avec un autre
    coefficient ;
  - une relation linéaire convient à une résistance à écoulement laminaire
    (pneumotachographe). Pour un simple orifice, le débit suit plutôt la racine carrée de la
    pression.
- **Statut** : 📝 compilé, pas encore testé sur la carte.

### C47 · CO₂ et O₂ simulés à partir de la respiration mesurée

- **Décision** : tant qu'il n'y a pas de capteur de gaz, le firmware calcule le CO₂ et l'O₂
  à partir de la phase de la respiration, donnée par la pression réelle (`SIM_GAS 1`).
  - Expiration (débit du signe `SIM_EXPIRATION_SIGN`, négatif) : pendant les
    `SIM_CO2_DEAD_S` premières secondes (0,15 s), c'est l'air de la bouche et des voies
    respiratoires (l'espace mort), sans CO₂. Ensuite le CO₂ monte vers la valeur de fin
    d'expiration : CO₂ = 0,04 + (5,0 − 0,04) × (1 − e^(−t / 0,10 s)).
  - Inspiration : air frais, le CO₂ retombe à 0,04 %.
  - O₂ = 20,95 − 1,2 × (CO₂ − 0,04) : chaque % de CO₂ rejeté correspond à environ 1,2 %
    d'O₂ consommé (quotient respiratoire ~0,85). En fin d'expiration : CO₂ 5 %, O₂ 15 %.
  - Les deux suivent ensuite avec le retard d'un vrai capteur de gaz (80 ms).
  - Le bruit ne doit pas changer la phase, d'où deux étages :
    - **seuil** (`SIM_GAS_DP_THRESHOLD`, 0,05 cmH₂O) : une pression plus faible ne compte
      pas du tout ;
    - **intégrateur** (`SIM_GAS_PHASE_INTEGRAL`, 0,02 cmH₂O·s) : ce qui dépasse le seuil
      dans le sens de l'autre phase est additionné au fil du temps, et la phase change quand
      la somme atteint cette valeur. Une pression dans le sens de la phase en cours vide la
      somme. Un pic isolé est trop court, une vraie respiration y arrive en ~0,3 s. Le
      début de la phase est daté au moment où la somme a commencé à se remplir.
  - En fin d'expiration, l'air de l'embout garde son CO₂ jusqu'à la prochaine inspiration,
    comme en vrai.
- **Pourquoi** : des courbes de gaz cohérentes avec la respiration réelle, pour développer
  l'affichage et l'analyse avant d'avoir les capteurs.
- **Conséquences** :
  - tous les paramètres sont dans `config.h` (`SIM_*`) ;
  - ce ne sont pas des mesures, et rien ne l'indique sur la page ni dans les fichiers
    (choix de l'équipe : on le sait). Attention avant de montrer des courbes à l'extérieur ;
  - le CO₂ de fin d'expiration est fixe (5 %), il ne dépend pas de l'effort.
- **Statut** : 🧪 vérifié sur une respiration type bruitée : bruit et pics seuls ne changent
  jamais la phase, une respiration la change 2 fois par cycle. Page testée en mode démo. 📝
  Pas encore testé sur la carte.

### C48 · Niveau de batterie

- **Décision** : une petite icône de pile, comme sur un téléphone, avec le % à côté, en haut
  à droite du panneau de l'appareil, sur la ligne du titre. La tension s'affiche au survol.
  Sous 15 %, l'icône passe en rouge et la page Direct affiche une alerte.
  - Écarté : une ligne avec une jauge dans le panneau, qui prenait trop de place pour une
    information qu'on regarde rarement.
  - Pas encore de batterie : une batterie fictive (`BATTERY_SIMULATED 1`) est pleine à la
    mise sous tension et vide au bout de `BATTERY_SIM_HOURS` (8 h).
  - Batterie réelle (`BATTERY_SIMULATED 0`) : tension lue sur D3 (GPIO 4) à travers un pont
    diviseur (`BATTERY_DIVIDER`, 2 par défaut : à vérifier sur la carte), moyenne de 16
    lectures toutes les 5 s, lissée. Le % vient de la courbe de décharge d'une LiPo une
    cellule (4,20 V = 100 %, 3,27 V = 0 %).
- **Pourquoi** : l'appareil doit pouvoir enregistrer seul, sur batterie. Il faut voir quand
  la recharger.
- **Conséquences** :
  - la tension d'une LiPo baisse un peu quand le Wi-Fi émet : le lissage évite que le % saute ;
  - on ne sait pas encore si la batterie est en charge (il faudrait lire l'état du chargeur).
- **Statut** : 🧪 page testée en mode démo. 📝 Lecture réelle compilée, pas encore testée
  (pas de batterie).

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
  - si la carte SD refuse une écriture, elle est retentée deux fois, puis la carte est
    remontée et le fichier rouvert (événement `sd_error`). La file de 10 s (C9) absorbe
    l'attente. Seulement si ça échoue aussi, l'enregistrement s'arrête proprement
    (événement `sd_failed`) et la page affiche l'erreur.
- **Pourquoi** : une séance avec un athlète ne se refait pas facilement. Mieux vaut un fichier
  incomplet mais valide qu'un fichier corrompu. La reprise après une écriture refusée vient
  d'un test de 1 h où l'enregistrement s'était arrêté seul au bout de 15 min (cause restée
  inconnue, pas revue depuis).
- **Statut** : 📝 tests de coupure de courant et de retrait de la carte SD à faire. La reprise
  après une écriture refusée n'a pas encore servi sur la carte.

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

- **Décision** : liaison par câble USB d'abord. Le Wi-Fi a été ajouté ensuite, en plus (C35).
- **Pourquoi** :
  - fiable, rien à configurer, et l'appareil est alimenté par le câble ;
  - suffisant sur tapis de course.
- **Écarté pour l'instant** :
  - le Wi-Fi seul (le PC perd internet en se connectant au réseau de l'appareil). Il est
    finalement venu en plus de l'USB, pas à sa place (C35) ;
  - le Bluetooth (choix des analyseurs portables du marché, comme VO2 Master ou PNOE, mais
    plus de travail).
- **Statut** : ✅.

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

### C27 · Mode démo masqué, pas d'étiquette « Simulé »

- **Décision** :
  - le mode démo (un faux appareil simulé dans la page) n'apparaît plus. Il reste accessible
    avec `index.html?demo`, pour les tests et les présentations. Un bandeau dit alors que
    rien n'est branché ;
  - les signaux simulés par le firmware (capteurs simulés, CO₂ et O₂ calculés, batterie
    fictive) ne portent aucune mention. Avant le 22 octobre 2026 : bandeau jaune et
    étiquette « Simulé ».
- **Pourquoi** :
  - la vraie carte fonctionne, donc le mode démo n'a plus à être mis en avant ;
  - l'équipe sait ce qui est simulé : les étiquettes encombraient l'écran.
- **Conséquences** : un fichier enregistré ne dit pas quelles voies étaient simulées. Il faut
  le noter dans les notes de la session si ça compte.
- **Statut** : 🧪 testé en mode démo.

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
- **Statut** : ⏳ prochaines étapes dans la section 10.

### C31 · Le parcours client (constat)

- **Constat** : aujourd'hui, un client sur un PC neuf devrait :
  1. récupérer et décompresser le dossier ;
  2. passer outre l'alerte Windows sur le `.bat` ;
  3. deviner que le port « USB JTAG/serial debug unit » est l'appareil ;
  4. reformater sa carte SD si elle fait 64 Go ou plus ;
  5. utiliser `flash.bat` pour les mises à jour du firmware. Ce n'est plus vrai depuis C42 : la
     mise à jour se fait depuis la page.
- **Cible proposée** : 3 gestes : installer l'appli (QR code sur l'appareil), brancher, cliquer
  sur Connecter une seule fois.
- **Statut** : ⏳ voir section 10.

---

## 8. Outils et méthode de travail

### C32 · Environnement de développement

- **Décision** :
  - le code est écrit et compilé dans WSL (Linux sous Windows) ;
  - comme WSL ne voit pas l'USB, la carte est flashée depuis Windows avec `flash.bat`
    (`esptool.exe`). Depuis la version 0.2.0, on peut aussi la mettre à jour depuis la page
    (C42) ;
  - les fichiers sont recopiés dans `C:\Users\vince\BreathLogger` ;
  - un Python portable y est inclus pour les outils de test.
- **Conséquences** : le dossier Windows n'est plus recopié à la main. `package/package.py`
  le fabrique (firmware compilé, page, outils, `esptool.exe` et Python portable téléchargés
  en versions fixées), et `--out` met à jour le dossier existant. `flash.bat` est dans Git
  (`package/flash.bat`). Détails dans `docs/development.md`.
- **Statut** : ✅.

### C33 · Outils de test

| Outil | Rôle |
|---|---|
| `tools/devtest.py` | Test complet sans navigateur : débit en direct, enregistrement avec pause, relecture du fichier avec contrôle CRC, aucune ligne manquante. |
| `tools/jitter.py` | Heure d'arrivée de chaque paquet sur le PC, trous, retards, compteurs de la carte. Résultats bruts en CSV. Par USB ou par Wi-Fi (`--wifi`). |
| `tools/wifitest.py` | Test Wi-Fi automatique d'1 minute : plusieurs écrans, règle « un seul écran commande », écran qui disparaît. |
| `tools/soaktest.py` | Test Wi-Fi de plusieurs heures : classe chaque coupure (appareil redémarré et pourquoi, PC parti du réseau…), avec en option un enregistrement vérifié à la fin. |
| `tools/otatest.py` | Mise à jour du firmware sans navigateur : fichier refusé, morceau abîmé renvoyé, installation, et avec `--crash` le retour automatique à l'ancienne version. |
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

## 9. Wi-Fi et mise à jour du firmware

Fait du 18 au 20 octobre 2026 sur une branche à part (`wifi-prototype`), puis ramené dans la
version principale une fois validé sur la carte.

### C35 · Le Wi-Fi en plus de l'USB, sur un réseau créé par l'appareil

- **Décision** :
  - l'appareil crée son propre réseau Wi-Fi, `BreathLogger-XXXX` (les 4 derniers caractères
    viennent de l'adresse de la puce, donc chaque appareil a un nom différent) ;
  - le PC, une tablette ou un téléphone s'y connecte et ouvre la page à `http://192.168.4.1` ;
  - l'USB reste là et marche en même temps. Le Wi-Fi est un moyen de liaison de plus, pas un
    remplacement.
- **Pourquoi** :
  - plus de câble entre l'athlète et le PC ;
  - marche partout, sans box ni internet, et sans rien régler selon le lieu.
- **Écarté** :
  - se connecter au Wi-Fi du lieu (salle, club) : il faudrait saisir le réseau et le mot de
    passe à chaque endroit, et il n'y en a pas toujours sur le terrain ;
  - le Bluetooth : débit plus faible, plus de travail, et pas de page servie par l'appareil.
- **Conséquences** :
  - pendant qu'il est sur le réseau de l'appareil, le PC n'a plus internet (sauf s'il est
    aussi relié par câble Ethernet) ;
  - mot de passe pour l'instant commun à tous les appareils (`breathlogger`) : voir O14 ;
  - 4 écrans au plus en même temps.
- **Statut** : ✅ validé sur la carte.

### C36 · La page est rangée dans le firmware

- **Décision** : à chaque compilation, le dossier `webapp` est compressé et ajouté au firmware
  (`embed_webapp.py`). En Wi-Fi, c'est l'appareil qui sert la page. Il fait aussi « portail
  captif » : en rejoignant le réseau, Windows, les téléphones et les tablettes ouvrent la page
  tout seuls.
- **Pourquoi** :
  - rien à installer sur le PC : n'importe quel navigateur suffit (en Wi-Fi, pas besoin de
    Web Serial) ;
  - la page et le firmware sont toujours de la même version.
- **Écarté** : ranger la page dans un espace de fichiers séparé de la mémoire (LittleFS). Il
  faudrait le flasher à part, avec le risque d'une page qui ne correspond pas au firmware.
- **Conséquences** : changer la page demande de recompiler et réinstaller le firmware. Depuis
  C42, ça se fait depuis la page elle-même.
- **Statut** : ✅ portail captif confirmé sur la carte. 📝 téléphones et tablettes pas encore
  essayés.

### C37 · Les mêmes messages qu'en USB, par une WebSocket

- **Décision** : en Wi-Fi, les messages JSON sont exactement ceux de l'USB (C20), un par
  message WebSocket, sur le port 81. Une réponse va seulement à l'écran qui a envoyé la
  commande ; les données, l'état et les événements vont à tous.
- **Pourquoi** : un seul protocole, donc la page et les outils de test servent pour les deux
  liaisons.
- **Statut** : ✅.

### C38 · Le Wi-Fi ne fait jamais attendre l'enregistrement

- **Décision** :
  - tout le Wi-Fi tourne dans sa propre tâche. La tâche E/S lui passe les messages par des
    files et ne l'attend jamais ;
  - les réponses ne sont jamais sautées. Les données en direct, elles, sont sautées pour un
    écran qui ne suit pas ;
  - un écran qui ne lit plus rien pendant 3 s, ou qui a quitté le réseau, est abandonné.
- **Pourquoi** : mesuré sur la carte, un écran disparu sans prévenir (Wi-Fi coupé, PC en
  veille) bloquait l'envoi jusqu'à ~10 s par message. Pendant un enregistrement, la file de
  10 s (C9) aurait pu déborder.
- **Conséquences** : la bibliothèque WebSocket est copiée dans le projet
  (`firmware/lib/WebSockets`) et corrigée. Un défaut d'Arduino 2.0.17 (une erreur laissée par
  une connexion fermée) lui faisait fermer les autres écrans quand l'un partait. Le détail
  est dans `PATCHED.md`.
- **Statut** : ✅ `wifitest.py` réussi ; test de 1 h avec enregistrement : 0 coupure, 179 992
  lignes, aucune perte.

### C39 · Un seul écran commande, les autres regardent

- **Décision** : en Wi-Fi, un seul écran peut changer quelque chose (démarrer, arrêter,
  renommer, supprimer, mettre à jour le firmware…). Les autres peuvent regarder, lister et
  lire, avec un bouton « Prendre la main ». Le premier écran connecté a la main ; quand il
  part, c'est celui connecté depuis le plus longtemps. L'USB peut toujours tout faire.
- **Pourquoi** : deux personnes qui commandent le même appareil en même temps (l'une arrête
  ce que l'autre vient de lancer) seraient une source d'erreurs pendant une séance.
- **Écarté** : tous les écrans égaux. C'est plus simple, mais les ordres se croiseraient.
- **Statut** : ✅.

### C40 · Marge d'affichage de 0,5 s en Wi-Fi

- **Décision** : en Wi-Fi, la page affiche avec 0,5 s de retard au lieu de 0,2 s (C26).
- **Pourquoi** : mesuré avec `jitter.py --wifi` sur 300 s : l'appareil envoie toujours à
  l'heure, mais le Wi-Fi livre parfois en retard : médiane 12 ms, 99 % sous 164 ms,
  maximum ~450 ms (côté radio et PC, par exemple quand le PC cherche d'autres réseaux).
- **Conséquences** : le défilement reste fluide. L'enregistrement n'est pas concerné : il est
  fait par l'appareil.
- **Statut** : ✅.

### C41 · Canal Wi-Fi choisi automatiquement

- **Décision** :
  - à la mise sous tension, l'appareil écoute les réseaux autour pendant ~2 s et prend le
    moins encombré des canaux 1, 6 et 11, les trois qui ne se chevauchent pas. Un réseau
    compte plus s'il est fort et sur le même canal, moins s'il est jusqu'à 4 canaux plus
    loin ;
  - après un redémarrage sans coupure de courant (mise à jour, plantage), il garde le canal
    d'avant sans réécouter : son réseau revient ~2 s plus tôt ;
  - la page montre le canal, et au survol ce que l'appareil a entendu.
- **Pourquoi** : le lieu change d'une séance à l'autre, un canal fixe peut tomber sur celui de
  la box d'à côté. Garder le canal au redémarrage : sur le PC de test, Windows revient alors
  tout seul sur le réseau de l'appareil.
- **Écarté** :
  - un canal fixe. Reste possible avec `WIFI_CHANNEL` dans `config.h` ;
  - changer de canal en cours de route : ça couperait tous les écrans.
- **Conséquences** : pour choisir à nouveau, débrancher ou éteindre l'appareil.
- **Statut** : ✅.

### C42 · Mise à jour du firmware depuis la page

- **Décision** :
  - dans le panneau Appareil, « Mettre à jour le firmware » : on choisit le fichier `.bin`,
    par USB ou par Wi-Fi ;
  - la page lit d'abord le fichier : un fichier qui n'est pas un firmware Breath Logger est
    refusé, et la page affiche la version et la date de celui qu'on va installer ;
  - le fichier part par morceaux de 2 Ko, chacun avec son CRC-32 (comme C23). Un morceau
    abîmé ou perdu est renvoyé ;
  - le nouveau firmware s'écrit dans **l'autre moitié** de la mémoire (deux emplacements de
    3,3 Mo). Celui qui tourne n'est pas touché tant que le fichier entier n'est pas arrivé et
    vérifié (marque Breath Logger, empreinte SHA-256 de toute l'image) ;
  - refusé pendant un enregistrement, et réservé à l'écran qui a la main (C39) ;
  - après le redémarrage, la page se reconnecte et affiche le résultat. En Wi-Fi, elle se
    recharge, puisque la nouvelle version apporte aussi sa page.
- **Pourquoi** : c'était la décision ouverte O6. `flash.bat` est un outil de développeur
  (Windows seulement, port COM à connaître, alerte de sécurité).
- **Écarté** : flasher depuis la page comme le fait `flash.bat` (esptool-js). Ça marche
  seulement par USB et réécrit tout, sans retour possible si la nouvelle version est mauvaise.
- **Conséquences** :
  - ~15 s d'envoi en Wi-Fi (~70 Ko/s pour 960 Ko), puis ~10 s de redémarrage ;
  - en Wi-Fi, si Windows ne revient pas seul sur le réseau de l'appareil, il faut l'y
    reconnecter à la main. La page le dit, puis reprend d'elle-même ;
  - la toute première version qui sait le faire (0.2.0) doit être installée avec
    `flash.bat` ;
  - `flash.bat` reste le secours si une version cassait à la fois l'USB et le Wi-Fi
    (maintenir BOOT en branchant si besoin).
- **Statut** : ✅ validé sur la carte, par la page et avec `otatest.py`.

### C43 · Retour automatique à l'ancienne version

- **Décision** : une nouvelle version n'est gardée qu'une fois qu'elle a fait ses preuves :
  dès qu'un écran lui parle, ou après 60 s sans plantage. Si elle redémarre avant (plantage,
  blocage), l'appareil revient tout seul à l'ancienne version, et la page le signale.
- **Pourquoi** : une mise à jour ratée chez un client ne doit pas laisser un appareil
  inutilisable.
- **Conséquences** :
  - une version qui tient 60 s mais casse à la fois l'USB et le Wi-Fi serait gardée. Seul
    `flash.bat` la rattraperait ;
  - un firmware de test fait exprès pour planter (`pio run -e crash-test`) vérifie ce retour.
- **Statut** : ✅ testé sur la carte avec `crash-test.bin` : retour seul à la version
  d'avant, signalé.

### C44 · Chaque firmware dit exactement qui il est

- **Décision** : à chaque compilation, `build_info.py` inscrit dans le firmware sa version
  (`FW_VERSION`, aujourd'hui 0.2.0), la date et l'heure de compilation, et le numéro de commit
  Git (avec un `+` si le code n'était pas encore commité). La page l'affiche ; la mise à jour
  s'en sert pour savoir si le changement a vraiment eu lieu.
- **Pourquoi** : deux compilations du même code ont maintenant chacune leur nom. Sans ça, on
  ne pouvait pas savoir quelle version tournait sur un appareil.
- **Statut** : ✅.

---

## 10. Décisions encore ouvertes

| # | Sujet | Options | Proposition |
|---|---|---|---|
| O1 | **Capteurs** | Pression : LPS28DFW (C5). Restent le CO₂ et l'O₂ : modèles, interfaces, unités, temps de réponse | Choisir en priorité le temps de réponse du CO₂ et de l'O₂, et prévoir le recalage dans le temps entre gaz et débit. |
| O2 | **Alimentation** | Batterie prévue sur D3 (C48), pas encore branchée | Choisir la batterie, vérifier le pont diviseur, mesurer la consommation. |
| O3 | ~~**Horloge RTC**~~ | Réglé : DS1307 (C4). | – |
| O4 | **Connexion automatique** | Garder « Connecter + choisir le port », ou se connecter seul à l'ouverture et après un débranchement | Se connecter seul, et ne montrer que l'appareil dans la liste des ports. Peu de travail, gros gain. |
| O5 | **Distribution aux clients** | A. appli web hébergée et installable (sans alerte Windows, mises à jour automatiques) · B. installateur `.exe` · C. appareil vu comme une clé USB | A. Questions : peut-on mettre l'appli en ligne ? Sur quel domaine ? |
| O6 | ~~**Mise à jour du firmware chez le client**~~ | Réglé : depuis la page (C42, C43). | – |
| O7 | **Cartes SD des clients** | Carte fournie déjà formatée, ou firmware qui lit l'exFAT | Fournir la carte. Vérifier la faisabilité de l'exFAT. |
| O8 | **Sessions simulées sur la SD** | Rien (choix actuel, C27), ou une mention « simulé » dans `meta.json` | Rien pour l'instant. À revoir avant de donner l'appareil à quelqu'un d'extérieur. |
| O9 | **Sans fil** | Le Wi-Fi est fait (C35 à C41). Reste à mesurer : portée avec une personne qui porte l'appareil, consommation. | Mesurer avant de décider d'une batterie (O2). |
| O10 | **Nom USB « Breath Logger »** | Garder l'USB intégré, ou passer à la pile TinyUSB | Garder pour l'instant (on perdrait le flash facile). |
| O11 | **Sécurité électrique** | PC sur secteur relié à un athlète | Isolateur USB, ou PC sur batterie pendant les tests. |
| O12 | **Cadre réglementaire et données** | Usage sportif ou médical | Médical : règlement européen sur les dispositifs médicaux (MDR). Sportif : marquage CE et RGPD. Le fait que les données restent sur le PC est un atout. |
| O13 | **Tests de robustesse** | Coupure de courant, retrait de la carte SD, plusieurs heures | 1 h en Wi-Fi avec enregistrement réussie (`soaktest.py`). Restent la coupure de courant et le retrait de la carte SD. |
| O14 | **Mot de passe Wi-Fi** | Commun à tous les appareils (aujourd'hui), ou propre à chaque appareil (étiquette ou QR code sur le boîtier) | Propre à chaque appareil. D'accord sur le principe, reporté. |

---

## 11. Chiffres clés

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
| Retard d'arrivée des données en Wi-Fi | médiane 12 ms, 99 % sous 164 ms, max ~450 ms | `jitter.py --wifi`, 300 s |
| Retard d'affichage voulu en Wi-Fi | 0,5 s | choix (C40) |
| Test Wi-Fi de 1 h avec enregistrement | 0 coupure, 179 992 lignes, 0 perte | `soaktest.py` |
| Envoi d'un firmware (960 Ko) en Wi-Fi | ~15 s (~70 Ko/s), plus ~10 s de redémarrage | `otatest.py` |
| Écoute des réseaux pour choisir le canal | ~2 s, à la mise sous tension seulement | C41 |

---

## 12. Glossaire

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
- **Point d'accès** : un appareil qui crée un réseau Wi-Fi, comme une box. Ici, c'est
  l'appareil lui-même.
- **Portail captif** : la page qui s'ouvre toute seule quand on rejoint un réseau Wi-Fi, comme
  dans un hôtel.
- **WebSocket** : une connexion qui reste ouverte entre une page web et un serveur, dans les
  deux sens. Elle remplace le port série quand on passe par le Wi-Fi.
- **Canal Wi-Fi** : la « fréquence » utilisée par un réseau. En 2,4 GHz, seuls les canaux 1,
  6 et 11 ne se chevauchent pas.
- **Mise à jour OTA** (*over the air*) : installer un nouveau firmware sans outil de flashage,
  par la liaison normale (ici USB ou Wi-Fi).
- **Retour en arrière (rollback)** : revenir automatiquement à l'ancienne version si la
  nouvelle ne démarre pas correctement.
