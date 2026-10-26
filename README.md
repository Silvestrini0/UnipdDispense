# UnipdDispense

UnipdDispense è un'applicazione desktop che sincronizza i materiali dei corsi Moodle dell'Università di Padova con una cartella locale, pronta da usare come vault Obsidian.

> Progetto indipendente e non affiliato all'Università degli Studi di Padova.

## Installazione

I pacchetti vengono generati per Linux, Windows e macOS quando viene pubblicata una release. L’app controlla le nuove versioni e consente di scaricarle e installarle dal pulsante in alto a destra; gli aggiornamenti automatici si possono attivare o disattivare nelle impostazioni. L’updater è disponibile per Windows (installer), Linux (AppImage, **.deb** e **.rpm**) e macOS. Per i pacchetti Linux installati, il sistema può chiedere conferma o la password amministratore durante l’installazione.

### Linux

- **AppImage:** scarica il file **.AppImage**, rendilo eseguibile dalle proprietà del file oppure esegui chmod +x UnipdDispense-*.AppImage, quindi avvialo.
- **Debian e Ubuntu:** scarica il file **.deb** e installalo con sudo apt install ./UnipdDispense-*.deb dalla cartella in cui si trova.
- **Fedora e distribuzioni compatibili:** scarica il file **.rpm** e installalo con sudo dnf install ./UnipdDispense-*.rpm.
- **Altre distribuzioni:** usa il pacchetto **AppImage**, che non richiede installazione ed è aggiornabile dall’app.

L’aggiornamento interno per i pacchetti **.deb** e **.rpm** è disponibile dalla versione 0.1.10. Se usi uno di questi pacchetti con una versione precedente, aggiorna manualmente alla 0.1.10 una volta; le versioni successive potranno poi essere installate dall’app.

Su Ubuntu, se l'icona dell'app nell'area di notifica non compare, installa il supporto AppIndicator con `sudo apt install libayatana-appindicator3-1`.

### Windows

Scarica e avvia **UnipdDispense-Windows-...-x64.exe** per installare l'app. L’updater integrato è disponibile per l’installazione tramite questo installer.

Le build Windows non sono firmate. Scarica l'installer solo dalla pagina [Releases ufficiale](https://github.com/Silvestrini0/UnipdDispense/releases) e, se Windows lo blocca, usa una delle procedure seguenti:

- **Avviso SmartScreen:** seleziona **Ulteriori informazioni** e poi **Esegui comunque**.
- **Smart App Control o blocco del file scaricato:** fai clic destro sull'installer, apri **Proprietà**, seleziona **Annulla blocco** nella sezione Sicurezza e premi **Applica**. Se la casella non compare, apri PowerShell ed esegui `Unblock-File -Path "$env:USERPROFILE\Downloads\UnipdDispense-Windows-*-x64.exe"`.

Questa operazione rimuove il contrassegno di provenienza Internet dal file selezionato; non disattiva Smart App Control né altre protezioni di Windows. Controlla che il file provenga dalla release ufficiale prima di sbloccarlo.

### macOS

Scarica il file **.dmg**, aprilo e trascina l'app in Applicazioni. È disponibile anche un archivio **.zip**. Sono pubblicati pacchetti per Mac Intel (x64) e Apple Silicon (arm64).

Le build macOS usano una firma ad hoc e non sono notarizzate. L’updater scarica e installa la release dal repository GitHub; può essere richiesta la password dell’amministratore per sostituire l’app in Applicazioni. Se Gatekeeper blocca la nuova versione, apri l’app una volta, poi vai in **Impostazioni di Sistema > Privacy e Sicurezza > Apri comunque** e conferma **Apri**. Puoi aprire questa schermata dal pulsante nell’app prima di riavviarla.

## Come funziona

1. Avvia l'app e scegli la piattaforma Moodle UniPD usata dai tuoi corsi.
2. Premi **Accedi con Moodle** e completa l'accesso Single Sign-On nella finestra UniPD. L'app non raccoglie la password: usa la sessione Moodle per ottenere l'accesso ai corsi.
3. Scegli il vault Obsidian da usare. Inizialmente viene proposta la cartella Documenti/UniPD; puoi cambiarla dalle impostazioni.
4. Avvia la sincronizzazione. Per impostazione predefinita vengono inclusi tutti i corsi visibili e l'app controlla le novità ogni 30 minuti mentre è in esecuzione. Puoi anche sincronizzare manualmente e modificare l'intervallo o selezionare i corsi dalle impostazioni.

I file vengono organizzati per corso e sezione in cartelle **Materiali** e **Informazioni**. Nel vault vengono creati anche un indice per corso, note con i dettagli dei file in **Schede file** e l'elenco dei contenuti rimossi da Moodle. Una rimozione su Moodle viene segnalata, ma la copia locale viene conservata.

La sezione **Materiali** dell'app permette di cercare e filtrare i file per corso, categoria e formato, ordinarli per nome o data e aprire i file con l'applicazione predefinita del sistema. PDF, immagini e note Markdown possono essere visualizzati in anteprima.

Quando il sistema operativo offre un portachiavi sicuro, il token di accesso viene conservato lì. L'app mostra nelle impostazioni lo stato effettivo dell'archiviazione.

## Sviluppo

Servono Node.js 22 o successivo e npm.

    npm ci
    npm run dev

Per creare una build locale per il sistema in uso:

    npm run build
    npm run dist

I pacchetti vengono salvati in dist/. La creazione dei pacchetti macOS richiede macOS ma non un certificato Developer ID; il workflow GitHub Actions usa runner Linux, Windows e macOS per generare automaticamente tutti gli artefatti a ogni tag v*. Il workflow pubblica anche i metadati richiesti dall’updater.

L’updater Mac verifica il checksum SHA-512 del pacchetto pubblicato prima di sostituire l’app. La conferma di Gatekeeper resta a carico dell’utente.

## Licenza

Distribuito con licenza MIT. Vedi [LICENSE](LICENSE).
