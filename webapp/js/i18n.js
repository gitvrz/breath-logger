// Texts of the interface in French and English, and date / duration formatting.
// To add a text: add the same key in both `fr` and `en`, then use t('key').

const I18N = {
  fr: {
    'app.tagline': 'Enregistreur respiratoire',
    'nav.live': 'Direct',
    'nav.recordings': 'Enregistrements',
    'pref.theme': 'Thème',
    'pref.system': 'Système',
    'pref.light': 'Clair',
    'pref.dark': 'Sombre',

    'device.title': 'Appareil',
    'device.none': 'Aucun appareil connecté',
    'device.connect': 'Connecter (USB)',
    'device.connectWifi': 'Connecter (Wi-Fi)',
    'device.connectedWifi': 'Connecté en Wi-Fi',
    'device.demo': 'Mode démo',
    'device.disconnect': 'Déconnecter',
    'device.connectedUsb': 'Connecté en USB',
    'device.connectedDemo': 'Mode démo',
    'device.fw': 'Firmware {fw} · {rate} Hz',
    'device.simulated': 'capteurs simulés',
    'device.sd': 'Carte SD',
    'device.sdFree': '{free} libres sur {total}',
    'device.sdFreeShort': '{free} libres',
    'device.sdMissing': 'Aucune carte',
    'device.clock': 'Horloge',
    'device.clockOk': 'Synchronisée',
    'device.clockNo': 'Non réglée',
    'device.lost': 'Échantillons perdus',
    'device.acq': 'Acquisition',
    'device.acqOk': 'OK',
    'device.acqStalled': 'Bloquée',
    'device.noSerial': 'Ce navigateur ne peut pas accéder à l\'USB. Utilisez Chrome ou Edge.',

    'live.title': 'Direct',
    'live.subtitle': 'Signaux en temps réel',
    'live.window': 'Fenêtre',
    'live.emptyTitle': 'Connectez votre appareil',
    'live.emptyText': 'Branchez l\'ESP32 en USB puis cliquez sur « Connecter ».',
    'live.emptyTextWifi': 'Connexion à l\'appareil en Wi-Fi… Cet écran doit être connecté au réseau Wi-Fi « BreathLogger-… » de l\'appareil.',
    'live.simTag': 'Simulé',
    'live.simFirmware': 'Capteurs simulés : ces courbes sont fabriquées par le firmware, aucun capteur n\'est lu. Les enregistrements faits ainsi ne contiennent pas de vraies mesures.',
    'live.simDemo': 'Mode démo : l\'appareil et les courbes sont simulés dans la page, rien n\'est branché.',
    'live.min': 'min',
    'live.max': 'max',
    'live.noSignal': 'Pas de signal',
    'live.cursorTag': 'Curseur',
    'control.label': 'Commande',
    'control.me': 'Cet écran',
    'control.take': 'Prendre la main',
    'control.other': 'Un autre écran commande l\'appareil : ici, vous pouvez regarder mais pas démarrer, arrêter ni modifier.',
    'err.readonly': 'Un autre écran commande l\'appareil. Cliquez sur « Prendre la main » pour commander depuis celui-ci.',
    'live.cursorAgo': 'il y a {s} s · pas la valeur actuelle',
    'fw.button': 'Mettre à jour le firmware',
    'fw.title': 'Mettre à jour le firmware',
    'fw.current': 'Version installée : {v} (compilée le {b})',
    'fw.pick': 'Choisir le fichier du firmware (.bin)',
    'fw.file': 'Nouveau firmware : version {v}, compilé le {b} · {size}.',
    'fw.same': 'C\'est la version déjà installée.',
    'fw.notFirmware': 'Ce fichier n\'est pas un firmware ESP32.',
    'fw.notOurs': 'Ce fichier n\'est pas un firmware Breath Logger, ou il date d\'avant la version 0.2.0 (dans ce cas, installez-le avec flash.bat).',
    'fw.help': 'Durée : environ une minute. Ne débranchez pas l\'appareil pendant l\'envoi. Il redémarre ensuite tout seul et la page se reconnecte. Si la nouvelle version ne démarre pas correctement, l\'appareil revient de lui-même à la version actuelle.',
    'fw.install': 'Installer',
    'fw.sending': 'Envoi… {pct} %',
    'fw.checking': 'L\'appareil vérifie le fichier…',
    'fw.restarting': 'Installé. L\'appareil redémarre sur la nouvelle version…',
    'fw.reconnectWifi': 'Installé. L\'appareil redémarre (environ 10 s). Si cet ordinateur ne revient pas tout seul sur le réseau {ssid}, reconnectez-le à la main : la page reprend d\'elle-même.',
    'fw.slow': 'L\'appareil ne revient pas. Vérifiez que cet ordinateur est reconnecté au réseau {ssid}. Sinon, débranchez puis rebranchez l\'appareil : s\'il n\'arrive pas à démarrer la nouvelle version, il revient de lui-même à l\'ancienne.',
    'fw.slowUsb': 'L\'appareil ne revient pas. Débranchez-le, rebranchez-le, puis cliquez sur « Connecter » : s\'il n\'arrive pas à démarrer la nouvelle version, il revient de lui-même à l\'ancienne.',
    'fw.done': 'Firmware {v} installé : l\'appareil fonctionne avec la nouvelle version.',
    'fw.rolledBack': 'La nouvelle version n\'a pas démarré correctement : l\'appareil est revenu de lui-même à la version {v}. Rien n\'est perdu.',
    'fw.other': 'L\'appareil fonctionne avec la version {v} ({b}), pas avec celle envoyée.',
    'fw.lastFailed': 'La dernière mise à jour n\'a pas démarré correctement : l\'appareil est revenu à cette version.',
    'fw.failed': 'Mise à jour impossible : {msg}. L\'appareil garde sa version actuelle.',
    'fw.cancelled': 'Mise à jour annulée : l\'appareil garde sa version actuelle.',
    'fw.needIdle': 'Arrêtez d\'abord l\'enregistrement',
    'fw.needControl': 'Seul l\'écran qui commande l\'appareil peut le mettre à jour',
    'fw.close': 'Fermer',
    'wifi.channel': 'canal {ch}',
    'wifi.channelAuto': 'Réseau {ssid}. Canal {ch}, choisi à la mise sous tension car le moins encombré. Réseaux entendus : {scan}.',
    'wifi.channelFixed': 'Réseau {ssid}, canal {ch} (fixé dans le firmware).',
    'wifi.scanItem': 'canal {ch} : {n}',
    'err.fwBusy': 'Une mise à jour du firmware est en cours',
    'alert.stalled': 'Plus aucune mesure depuis {s} s : l\'acquisition est bloquée. Vérifiez les capteurs et leur câblage.',
    'alert.noData': 'Aucune donnée reçue de l\'appareil depuis {s} s. Vérifiez le câble USB.',
    'alert.faults': 'Pas de valeur valide pour : {list}. Vérifiez ce capteur.',

    'setup.recording': 'Enregistrement',
    'setup.recordingPh': 'ex. sujet01',
    'setup.new': 'Nouveau',
    'setup.existing': 'Existant',
    'setup.nameHelp': 'Lettres, chiffres, _ et - (32 max.)',
    'setup.session': 'Session',
    'setup.newSession': 'Nouvelle session',
    'setup.continueSession': 'Continuer une session',
    'setup.notes': 'Notes',
    'setup.notesPh': 'Optionnel',
    'setup.start': 'Démarrer',
    'setup.noSd': 'Insérez une carte SD pour enregistrer',
    'setup.noSessions': 'Aucune session à continuer',
    'setup.sessionOption': 'Session {id} · {date} · {dur}',

    'rec.recording': 'Enregistrement',
    'rec.paused': 'En pause',
    'rec.pause': 'Pause',
    'rec.resume': 'Reprendre',
    'rec.stop': 'Arrêter',
    'rec.session': 'Session {id}',
    'rec.since': 'Démarrée {date}',
    'rec.continuedSince': 'Reprise {date}',
    'rec.samples': '{n} échantillons',
    'rec.recorded': 'enregistrées',
    'rec.sessionTotal': 'Session : {dur} au total',

    'list.title': 'Enregistrements',
    'list.subtitle': 'Contenu de la carte SD',
    'list.refresh': 'Actualiser',
    'list.new': 'Nouvel enregistrement',
    'list.search': 'Rechercher',
    'list.empty': 'Aucun enregistrement pour l\'instant.',
    'list.noMatch': 'Aucun résultat.',
    'list.notConnected': 'Connectez un appareil pour voir ses enregistrements.',
    'list.sessions': '{n} session|{n} sessions',
    'list.today': 'Aujourd\'hui',
    'list.yesterday': 'Hier',
    'list.thisWeek': 'Cette semaine',
    'list.noDate': 'Sans session',
    'list.damaged': 'Fichier meta.json absent ou abîmé',
    'list.busy': 'Un enregistrement est en cours : les modifications sont désactivées jusqu\'à l\'arrêt.',
    'list.select': 'Sélectionnez un enregistrement',
    'list.trash': 'Corbeille',
    'list.selectText': 'Ses sessions, dates et notes s\'afficheront ici.',

    'detail.created': 'Créé le {date}',
    'detail.newSession': 'Nouvelle session',
    'detail.rename': 'Renommer',
    'detail.delete': 'Supprimer',
    'detail.kpiSessions': 'Sessions',
    'detail.kpiDuration': 'Durée enregistrée',
    'detail.kpiLast': 'Dernière activité',
    'detail.notes': 'Notes',
    'detail.notesPh': 'Ajouter des notes sur ce sujet ou ce protocole…',
    'detail.saved': 'Enregistré',
    'detail.sessions': 'Sessions',
    'detail.noSessions': 'Aucune session. Démarrez-en une avec « Nouvelle session ».',
    'detail.inProgress': 'En cours',
    'detail.interrupted': 'Interrompue',
    'detail.interruptedHelp': 'Pas d\'arrêt enregistré : coupure de courant ou redémarrage. Les données jusqu\'à l\'interruption sont conservées.',
    'detail.pauses': '{n} pause|{n} pauses',
    'detail.part': 'Partie {n}',
    'detail.partContinued': 'reprise',
    'detail.view': 'Voir les courbes',
    'detail.continue': 'Continuer l\'enregistrement',
    'detail.csv': 'CSV',
    'detail.editNotes': 'Notes',
    'detail.deleteSession': 'Supprimer la session',
    'detail.trimmed': 'Rognée',
    'detail.trimmedHelp': 'Une partie est masquée. Le fichier d\'origine reste intact sur la carte SD.',
    'detail.restore': 'Tout afficher',
    'detail.lost': '{n} échantillon perdu|{n} échantillons perdus',
    'detail.sdFailed': 'Arrêtée : carte SD',
    'detail.sdFailedHelp': 'La carte SD a refusé d\'écrire, même après plusieurs essais : l\'appareil a arrêté l\'enregistrement. Les données jusque-là sont conservées. Vérifiez ou changez la carte.',
    'detail.sdError': 'Carte SD : {n} reprise|Carte SD : {n} reprises',
    'detail.sdErrorHelp': 'La carte SD a refusé une écriture : l\'appareil l\'a relancée et l\'enregistrement a continué sans perte. Une ligne peut être abîmée à cet endroit.',
    'detail.lostHelp': 'Des mesures n\'ont pas pu être écrites à temps sur la carte SD. Les trous sont signalés sur les courbes.',

    'view.back': 'Enregistrements',
    'view.axis': 'Axe du temps',
    'view.elapsed': 'Durée',
    'view.clock': 'Heure',
    'view.resetZoom': 'Réinitialiser le zoom',
    'view.trim': 'Garder la sélection',
    'view.trimHelp': 'Faites d\'abord glisser sur un graphique pour sélectionner la partie à garder',
    'view.download': 'Télécharger CSV',
    'view.hint': 'Glissez sur un graphique pour zoomer · double-clic pour revenir',
    'view.loading': 'Lecture depuis l\'appareil…',
    'view.mean': 'moyenne',
    'view.at': 'à {time}',
    'view.pause': 'Pause · {dur}',
    'view.continued': 'Reprise · {date}',
    'view.gap': 'Interruption',
    'view.lost': 'Perte · {n} éch.',
    'view.stall': 'Capteurs bloqués',
    'view.start': 'Début · {date}',

    'dlg.cancel': 'Annuler',
    'dlg.ok': 'OK',
    'dlg.save': 'Enregistrer',
    'dlg.newRecTitle': 'Nouvel enregistrement',
    'dlg.newRecText': 'Un enregistrement regroupe toutes les sessions d\'un même sujet ou protocole.',
    'dlg.name': 'Nom',
    'dlg.renameTitle': 'Renommer « {rec} »',
    'dlg.deleteRecTitle': 'Supprimer « {rec} » ?',
    'dlg.deleteRecText': 'L\'enregistrement et toutes ses sessions sont déplacés dans la corbeille de la carte SD. Vous pourrez les récupérer tant que la corbeille n\'est pas vidée.',
    'dlg.deleteSessionTitle': 'Supprimer la session {id} ?',
    'dlg.deleteSessionText': 'Ses données sont déplacées dans la corbeille de la carte SD. Vous pourrez les récupérer tant que la corbeille n\'est pas vidée.',
    'dlg.delete': 'Supprimer',
    'dlg.continueTitle': 'Continuer la session {id} ?',
    'dlg.continueText': 'L\'enregistrement reprend maintenant et s\'ajoute à la fin de la session {id} de « {rec} ». La date et l\'heure de reprise sont mémorisées.',
    'dlg.continueGo': 'Reprendre l\'enregistrement',
    'dlg.newSessionTitle': 'Nouvelle session pour « {rec} »',
    'dlg.newSessionText': 'L\'enregistrement démarre dès que vous confirmez.',
    'dlg.startNow': 'Démarrer',
    'dlg.sessionNotesTitle': 'Notes de la session {id}',
    'dlg.trimTitle': 'Garder uniquement la sélection ?',
    'dlg.trimText': 'Seule la partie {from} → {to} de la session {id} sera affichée et exportée. Le reste est masqué, pas effacé : le fichier d\'origine reste intact sur la carte SD et « Tout afficher » le fait réapparaître.',
    'dlg.trimGo': 'Rogner la session',
    'dlg.downloadTitle': 'Télécharger la session {id}',
    'dlg.downloadText': 'Fichier CSV : temps en secondes depuis le début de la session, puis CO₂, O₂, débit et pression.',
    'dlg.addDatetime': 'Ajouter une colonne date et heure',
    'dlg.includeHidden': 'Inclure les parties masquées par le rognage (données complètes)',
    'dlg.restoreTitle': 'Tout afficher dans la session {id} ?',
    'dlg.restoreText': 'Annule le rognage : toutes les données enregistrées redeviennent visibles. L\'opération est notée dans l\'historique de la session.',
    'dlg.restoreGo': 'Tout afficher',
    'dlg.download': 'Télécharger',
    'dlg.trashTitle': 'Corbeille de la carte SD',
    'dlg.trashText': '{n} élément(s), {size}. Les enregistrements et sessions supprimés sont gardés dans le dossier /trash de la carte. Pour en récupérer un, lisez la carte sur un ordinateur. Vider la corbeille les efface définitivement.',
    'dlg.trashEmpty': 'Vider la corbeille',
    'dlg.invalidName': 'Utilisez uniquement des lettres, chiffres, _ et - (32 caractères max.)',
    'dlg.nameTaken': 'Ce nom est déjà utilisé',

    'toast.connected': 'Appareil connecté',
    'toast.disconnected': 'Appareil déconnecté. Un enregistrement en cours continue sur la carte SD.',
    'toast.noAnswer': 'L\'appareil ne répond pas. Le bon firmware est-il installé ?',
    'toast.openFailed': 'Impossible d\'ouvrir l\'appareil : {msg}',
    'toast.started': 'Enregistrement démarré : {rec}, session {id}',
    'toast.continued': 'Session {id} de {rec} reprise',
    'toast.stopped': 'Enregistrement arrêté et sauvegardé',
    'toast.trimmed': 'Session rognée',
    'toast.restored': 'Toutes les données sont de nouveau visibles',
    'toast.renamed': 'Enregistrement renommé',
    'toast.deleted': 'Déplacé dans la corbeille',
    'toast.trashIsEmpty': 'La corbeille est vide',
    'toast.trashEmptied': 'Corbeille vidée',
    'toast.created': 'Enregistrement « {rec} » créé',

    'err.busy': 'Arrêtez d\'abord l\'enregistrement en cours',
    'err.noSd': 'Aucune carte SD dans l\'appareil',
    'err.invalidName': 'Nom invalide : lettres, chiffres, _ et - uniquement (32 max.)',
    'err.exists': 'Un enregistrement porte déjà ce nom',
    'err.notFound': 'Enregistrement introuvable',
    'err.clock': 'Impossible de continuer : l\'horloge de cette session n\'était pas réglée',
    'err.sdWrite': 'Erreur d\'écriture sur la carte SD : enregistrement arrêté',
    'err.disconnected': 'Appareil déconnecté',
    'err.timeout': 'L\'appareil ne répond pas',
    'err.stalled': 'Acquisition bloquée : plus aucune mesure depuis 1 s',
    'err.range': 'Sélection invalide',
    'err.nothingKept': 'Aucune donnée dans cette sélection',
    'err.tooManyTrims': 'Trop de rognages sur cette session : cliquez d\'abord « Tout afficher »',
  },

  en: {
    'app.tagline': 'Respiratory recorder',
    'nav.live': 'Live',
    'nav.recordings': 'Recordings',
    'pref.theme': 'Theme',
    'pref.system': 'System',
    'pref.light': 'Light',
    'pref.dark': 'Dark',

    'device.title': 'Device',
    'device.none': 'No device connected',
    'device.connect': 'Connect (USB)',
    'device.connectWifi': 'Connect (Wi-Fi)',
    'device.connectedWifi': 'Connected over Wi-Fi',
    'device.demo': 'Demo mode',
    'device.disconnect': 'Disconnect',
    'device.connectedUsb': 'Connected over USB',
    'device.connectedDemo': 'Demo mode',
    'device.fw': 'Firmware {fw} · {rate} Hz',
    'device.simulated': 'simulated sensors',
    'device.sd': 'SD card',
    'device.sdFree': '{free} free of {total}',
    'device.sdFreeShort': '{free} free',
    'device.sdMissing': 'No card',
    'device.clock': 'Clock',
    'device.clockOk': 'Synced',
    'device.clockNo': 'Not set',
    'device.lost': 'Lost samples',
    'device.acq': 'Acquisition',
    'device.acqOk': 'OK',
    'device.acqStalled': 'Stalled',
    'device.noSerial': 'This browser can\'t access USB. Use Chrome or Edge.',

    'live.title': 'Live',
    'live.subtitle': 'Real-time signals',
    'live.window': 'Window',
    'live.emptyTitle': 'Connect your device',
    'live.emptyText': 'Plug the ESP32 over USB and click "Connect".',
    'live.emptyTextWifi': 'Connecting to the device over Wi-Fi… This screen must be on the device\'s "BreathLogger-…" Wi-Fi network.',
    'live.simTag': 'Simulated',
    'live.simFirmware': 'Simulated sensors: these traces are made up by the firmware, no sensor is read. Recordings made like this contain no real measurements.',
    'live.simDemo': 'Demo mode: the device and the traces are simulated in the page, nothing is plugged in.',
    'live.min': 'min',
    'live.max': 'max',
    'live.noSignal': 'No signal',
    'live.cursorTag': 'Cursor',
    'control.label': 'Control',
    'control.me': 'This screen',
    'control.take': 'Take control',
    'control.other': 'Another screen controls the device: here you can watch but not start, stop or change anything.',
    'err.readonly': 'Another screen controls the device. Click "Take control" to control it from this one.',
    'live.cursorAgo': '{s} s ago · not the current value',
    'fw.button': 'Update firmware',
    'fw.title': 'Update the firmware',
    'fw.current': 'Installed version: {v} (built {b})',
    'fw.pick': 'Choose the firmware file (.bin)',
    'fw.file': 'New firmware: version {v}, built {b} · {size}.',
    'fw.same': 'This is the version already installed.',
    'fw.notFirmware': 'This file is not an ESP32 firmware.',
    'fw.notOurs': 'This file is not a Breath Logger firmware, or it predates version 0.2.0 (then install it with flash.bat).',
    'fw.help': 'Takes about a minute. Do not unplug the device while sending. It then restarts by itself and the page reconnects. If the new version does not start properly, the device goes back to the current version by itself.',
    'fw.install': 'Install',
    'fw.sending': 'Sending… {pct} %',
    'fw.checking': 'The device is checking the file…',
    'fw.restarting': 'Installed. The device is restarting on the new version…',
    'fw.reconnectWifi': 'Installed. The device is restarting (about 10 s). If this computer does not rejoin the {ssid} network by itself, rejoin it by hand: the page picks up by itself.',
    'fw.slow': 'The device does not come back. Check that this computer has rejoined the {ssid} network. Otherwise unplug and replug the device: if it cannot start the new version, it goes back to the old one by itself.',
    'fw.slowUsb': 'The device does not come back. Unplug it, plug it back, then click "Connect": if it cannot start the new version, it goes back to the old one by itself.',
    'fw.done': 'Firmware {v} installed: the device runs the new version.',
    'fw.rolledBack': 'The new version did not start properly: the device went back to version {v} by itself. Nothing is lost.',
    'fw.other': 'The device runs version {v} ({b}), not the one sent.',
    'fw.lastFailed': 'The last update did not start properly: the device went back to this version.',
    'fw.failed': 'Update failed: {msg}. The device keeps its current version.',
    'fw.cancelled': 'Update cancelled: the device keeps its current version.',
    'fw.needIdle': 'Stop the recording first',
    'fw.needControl': 'Only the screen in control of the device can update it',
    'fw.close': 'Close',
    'wifi.channel': 'channel {ch}',
    'wifi.channelAuto': 'Network {ssid}. Channel {ch}, chosen at power-on as the least crowded. Networks heard: {scan}.',
    'wifi.channelFixed': 'Network {ssid}, channel {ch} (set in the firmware).',
    'wifi.scanItem': 'channel {ch}: {n}',
    'err.fwBusy': 'A firmware update is in progress',
    'alert.stalled': 'No measurement for {s} s: acquisition is stalled. Check the sensors and their wiring.',
    'alert.noData': 'No data from the device for {s} s. Check the USB cable.',
    'alert.faults': 'No valid value for: {list}. Check this sensor.',

    'setup.recording': 'Recording',
    'setup.recordingPh': 'e.g. subject01',
    'setup.new': 'New',
    'setup.existing': 'Existing',
    'setup.nameHelp': 'Letters, digits, _ and - (max 32)',
    'setup.session': 'Session',
    'setup.newSession': 'New session',
    'setup.continueSession': 'Continue a session',
    'setup.notes': 'Notes',
    'setup.notesPh': 'Optional',
    'setup.start': 'Start',
    'setup.noSd': 'Insert an SD card to record',
    'setup.noSessions': 'No session to continue',
    'setup.sessionOption': 'Session {id} · {date} · {dur}',

    'rec.recording': 'Recording',
    'rec.paused': 'Paused',
    'rec.pause': 'Pause',
    'rec.resume': 'Resume',
    'rec.stop': 'Stop',
    'rec.session': 'Session {id}',
    'rec.since': 'Started {date}',
    'rec.continuedSince': 'Resumed {date}',
    'rec.samples': '{n} samples',
    'rec.recorded': 'recorded',
    'rec.sessionTotal': 'Session total: {dur}',

    'list.title': 'Recordings',
    'list.subtitle': 'Content of the SD card',
    'list.refresh': 'Refresh',
    'list.new': 'New recording',
    'list.search': 'Search',
    'list.empty': 'No recordings yet.',
    'list.noMatch': 'No match.',
    'list.notConnected': 'Connect a device to see its recordings.',
    'list.sessions': '{n} session|{n} sessions',
    'list.today': 'Today',
    'list.yesterday': 'Yesterday',
    'list.thisWeek': 'This week',
    'list.noDate': 'No sessions',
    'list.damaged': 'meta.json missing or damaged',
    'list.busy': 'A recording is running: editing is disabled until it stops.',
    'list.select': 'Select a recording',
    'list.trash': 'Trash',
    'list.selectText': 'Its sessions, dates and notes will appear here.',

    'detail.created': 'Created {date}',
    'detail.newSession': 'New session',
    'detail.rename': 'Rename',
    'detail.delete': 'Delete',
    'detail.kpiSessions': 'Sessions',
    'detail.kpiDuration': 'Recorded time',
    'detail.kpiLast': 'Last activity',
    'detail.notes': 'Notes',
    'detail.notesPh': 'Add notes about this subject or protocol…',
    'detail.saved': 'Saved',
    'detail.sessions': 'Sessions',
    'detail.noSessions': 'No sessions. Start one with "New session".',
    'detail.inProgress': 'In progress',
    'detail.interrupted': 'Interrupted',
    'detail.interruptedHelp': 'No stop recorded: power cut or reset. Data up to the interruption is kept.',
    'detail.pauses': '{n} pause|{n} pauses',
    'detail.part': 'Part {n}',
    'detail.partContinued': 'resumed',
    'detail.view': 'View signals',
    'detail.continue': 'Continue recording',
    'detail.csv': 'CSV',
    'detail.editNotes': 'Notes',
    'detail.deleteSession': 'Delete session',
    'detail.trimmed': 'Trimmed',
    'detail.trimmedHelp': 'Part of it is hidden. The original file is untouched on the SD card.',
    'detail.restore': 'Show all',
    'detail.lost': '{n} lost sample|{n} lost samples',
    'detail.sdFailed': 'Stopped: SD card',
    'detail.sdFailedHelp': 'The SD card refused to write, even after several tries: the device stopped the recording. Data up to there is kept. Check or replace the card.',
    'detail.sdError': 'SD card: {n} recovery|SD card: {n} recoveries',
    'detail.sdErrorHelp': 'The SD card refused a write: the device restarted it and the recording went on without loss. One row may be damaged at that spot.',
    'detail.lostHelp': 'Some measurements could not be written to the SD card in time. The gaps are marked on the charts.',

    'view.back': 'Recordings',
    'view.axis': 'Time axis',
    'view.elapsed': 'Duration',
    'view.clock': 'Clock',
    'view.resetZoom': 'Reset zoom',
    'view.trim': 'Keep selection',
    'view.trimHelp': 'First drag on a chart to select the part to keep',
    'view.download': 'Download CSV',
    'view.hint': 'Drag on a chart to zoom · double-click to reset',
    'view.loading': 'Reading from the device…',
    'view.mean': 'mean',
    'view.at': 'at {time}',
    'view.pause': 'Pause · {dur}',
    'view.continued': 'Resumed · {date}',
    'view.gap': 'Interruption',
    'view.start': 'Start · {date}',
    'view.lost': 'Lost · {n} samples',
    'view.stall': 'Sensors stalled',

    'dlg.cancel': 'Cancel',
    'dlg.ok': 'OK',
    'dlg.save': 'Save',
    'dlg.newRecTitle': 'New recording',
    'dlg.newRecText': 'A recording groups all the sessions of one subject or protocol.',
    'dlg.name': 'Name',
    'dlg.renameTitle': 'Rename "{rec}"',
    'dlg.deleteRecTitle': 'Delete "{rec}"?',
    'dlg.deleteRecText': 'The recording and all its sessions are moved to the SD card trash. They can be recovered until the trash is emptied.',
    'dlg.deleteSessionTitle': 'Delete session {id}?',
    'dlg.deleteSessionText': 'Its data is moved to the SD card trash. It can be recovered until the trash is emptied.',
    'dlg.delete': 'Delete',
    'dlg.continueTitle': 'Continue session {id}?',
    'dlg.continueText': 'Recording starts now and is appended to session {id} of "{rec}". The date and time of the resumption are kept.',
    'dlg.continueGo': 'Resume recording',
    'dlg.newSessionTitle': 'New session for "{rec}"',
    'dlg.newSessionText': 'Recording starts as soon as you confirm.',
    'dlg.startNow': 'Start',
    'dlg.sessionNotesTitle': 'Notes for session {id}',
    'dlg.trimTitle': 'Keep only the selection?',
    'dlg.trimText': 'Only {from} → {to} of session {id} will be shown and exported. The rest is hidden, not erased: the original file stays untouched on the SD card and "Show all" brings it back.',
    'dlg.trimGo': 'Trim session',
    'dlg.downloadTitle': 'Download session {id}',
    'dlg.downloadText': 'CSV file: time in seconds since the session start, then CO₂, O₂, flow and pressure.',
    'dlg.addDatetime': 'Add a date and time column',
    'dlg.includeHidden': 'Include the parts hidden by the trim (full data)',
    'dlg.restoreTitle': 'Show everything in session {id}?',
    'dlg.restoreText': 'Cancels the trim: all recorded data becomes visible again. This is logged in the session history.',
    'dlg.restoreGo': 'Show all',
    'dlg.download': 'Download',
    'dlg.trashTitle': 'SD card trash',
    'dlg.trashText': '{n} item(s), {size}. Deleted recordings and sessions are kept in the /trash folder of the card. To recover one, read the card on a computer. Emptying the trash erases them for good.',
    'dlg.trashEmpty': 'Empty trash',
    'dlg.invalidName': 'Use only letters, digits, _ and - (max 32 characters)',
    'dlg.nameTaken': 'This name is already used',

    'toast.connected': 'Device connected',
    'toast.disconnected': 'Device disconnected. A recording in progress continues on the SD card.',
    'toast.noAnswer': 'The device does not answer. Is the right firmware installed?',
    'toast.openFailed': 'Could not open the device: {msg}',
    'toast.started': 'Recording started: {rec}, session {id}',
    'toast.continued': 'Session {id} of {rec} resumed',
    'toast.stopped': 'Recording stopped and saved',
    'toast.trimmed': 'Session trimmed',
    'toast.restored': 'All data is visible again',
    'toast.renamed': 'Recording renamed',
    'toast.deleted': 'Moved to the trash',
    'toast.trashIsEmpty': 'The trash is empty',
    'toast.trashEmptied': 'Trash emptied',
    'toast.created': 'Recording "{rec}" created',

    'err.busy': 'Stop the current recording first',
    'err.noSd': 'No SD card in the device',
    'err.invalidName': 'Invalid name: letters, digits, _ and - only (max 32)',
    'err.exists': 'A recording with this name already exists',
    'err.notFound': 'Recording not found',
    'err.clock': 'Cannot continue: this session\'s clock was not set',
    'err.sdWrite': 'SD card write error: recording stopped',
    'err.disconnected': 'Device disconnected',
    'err.timeout': 'The device does not answer',
    'err.stalled': 'Acquisition stalled: no measurement for 1 s',
    'err.range': 'Invalid selection',
    'err.nothingKept': 'No data in this selection',
    'err.tooManyTrims': 'Too many trims on this session: click "Show all" first',
  },
};

let LANG = (() => {
  try {
    const saved = localStorage.getItem('lang');
    if (saved && I18N[saved]) return saved;
  } catch {}
  return (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
})();

// t('list.sessions', { n: 3 }) -> "3 sessions" ("a|b" = singular|plural, chosen with n)
function t(key, vars) {
  let s = I18N[LANG][key] ?? I18N.en[key] ?? key;
  if (s.includes('|') && vars && 'n' in vars) s = s.split('|')[Math.abs(vars.n) === 1 ? 0 : 1];
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}

function setLang(lang) {
  LANG = lang;
  try {
    localStorage.setItem('lang', lang);
  } catch {}
  document.documentElement.lang = lang;
  applyI18n();
}

// Static texts in the HTML: data-i18n, data-i18n-placeholder, data-i18n-title
function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  root.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
}

// Device error messages arrive in English: translate the common ones
function errText(e) {
  const m = String(e?.message ?? e);
  const map = [
    ['read-only', 'err.readonly'], ['firmware update is in progress', 'err.fwBusy'], ['not a Breath Logger firmware', 'fw.notOurs'], ['busy', 'err.busy'], ['no SD card', 'err.noSd'], ['invalid range', 'err.range'], ['invalid', 'err.invalidName'],
    ['nothing to keep', 'err.nothingKept'], ['too many trims', 'err.tooManyTrims'],
    ['already exists', 'err.exists'], ['recording not found', 'err.notFound'],
    ['clock not set', 'err.clock'], ['SD write failed', 'err.sdWrite'],
    ['device disconnected', 'err.disconnected'], ['did not answer', 'err.timeout'],
    ['acquisition stalled', 'err.stalled'],
  ];
  const hit = map.find(([k]) => m.includes(k));
  return hit ? t(hit[1]) : m;
}

// ---- dates & durations -------------------------------------------------------

const locale = () => (LANG === 'fr' ? 'fr-FR' : 'en-GB');

function sameDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

// "12 oct. 2026, 14:02"
function fmtDateTime(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ms);
}

// "aujourd'hui 14:02" / "hier 09:10" / "12 oct. 14:02" (year only if not this year)
function fmtWhen(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  const now = Date.now();
  const time = fmtTime(ms, false);
  if (sameDay(ms, now)) return `${t('list.today').toLowerCase()} ${time}`;
  if (sameDay(ms, now - 864e5)) return `${t('list.yesterday').toLowerCase()} ${time}`;
  const opts = { day: 'numeric', month: 'short' };
  if (new Date(ms).getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric';
  return `${new Intl.DateTimeFormat(locale(), opts).format(ms)} ${time}`;
}

// "14:02" or "14:02:10"
function fmtTime(ms, seconds = true) {
  const opts = { hour: '2-digit', minute: '2-digit' };
  if (seconds) opts.second = '2-digit';
  return new Intl.DateTimeFormat(locale(), opts).format(ms);
}

// "12/10"
function fmtShortDay(ms) {
  return new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit' }).format(ms);
}

// "Octobre 2026"
function fmtMonth(ms) {
  const s = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(ms);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Human duration: "45 s", "12 min 05 s", "1 h 02 min"
function fmtDur(s) {
  if (s == null || !isFinite(s)) return '—';
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h} h ${pad2(m)} min`;
  if (m) return `${m} min ${pad2(sec)} s`;
  return `${sec} s`;
}

// Stopwatch: "4:05", "1:02:05"
function fmtTimer(s) {
  if (s == null || !isFinite(s)) return '0:00';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}

function fmtNumber(n) {
  return new Intl.NumberFormat(locale()).format(n);
}

function fmtSize(mb) {
  return mb >= 1024 ? `${(mb / 1024).toLocaleString(locale(), { maximumFractionDigits: 1 })} ${LANG === 'fr' ? 'Go' : 'GB'}` : `${mb} ${LANG === 'fr' ? 'Mo' : 'MB'}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
