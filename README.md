# UnipdDispense

UnipdDispense è un'applicazione desktop che sincronizza i materiali dei corsi Moodle dell'Università di Padova con una cartella locale, pronta da usare come vault Obsidian.

> Progetto indipendente e non affiliato all'Università degli Studi di Padova.

## Installazione

Scarica l'ultima versione dalla pagina [Releases](https://github.com/Silvestrini0/UnipdDispense/releases/latest). I pacchetti vengono generati per Linux, Windows e macOS quando viene pubblicata una release.

### Linux

- **AppImage:** scarica il file **.AppImage**, rendilo eseguibile dalle proprietà del file oppure esegui chmod +x UnipdDispense-*.AppImage, quindi avvialo.
- **Debian e Ubuntu:** scarica il file **.deb** e installalo con sudo apt install ./UnipdDispense-*.deb dalla cartella in cui si trova.
- **Fedora e distribuzioni compatibili:** scarica il file **.rpm** e installalo con sudo dnf install ./UnipdDispense-*.rpm.
- **Altre distribuzioni:** estrai il pacchetto **.tar.gz** e avvia l'applicazione contenuta nella cartella estratta.

Su Ubuntu, se l'icona dell'app nell'area di notifica non compare, installa il supporto AppIndicator con `sudo apt install libayatana-appindicator3-1`.

### Windows

Scarica e avvia **UnipdDispense-Setup-...-x64.exe** per installare l'app. In alternativa, estrai il file **.zip** ed esegui l'applicazione dalla cartella estratta.

Le build Windows non sono firmate. Scarica l'installer solo dalla pagina [Releases ufficiale](https://github.com/Silvestrini0/UnipdDispense/releases) e, se Windows lo blocca, usa una delle procedure seguenti:

- **Avviso SmartScreen:** seleziona **Ulteriori informazioni** e poi **Esegui comunque**.
- **Smart App Control o blocco del file scaricato:** fai clic destro sull'installer, apri **Proprietà**, seleziona **Annulla blocco** nella sezione Sicurezza e premi **Applica**. Se la casella non compare, apri PowerShell ed esegui `Unblock-File -Path "$env:USERPROFILE\Downloads\UnipdDispense-Setup-*-x64.exe"`.

Questa operazione rimuove il contrassegno di provenienza Internet dal file selezionato; non disattiva Smart App Control né altre protezioni di Windows. Controlla che il file provenga dalla release ufficiale prima di sbloccarlo.

### macOS

Scarica il file **.dmg**, aprilo e trascina l'app in Applicazioni. È disponibile anche un archivio **.zip**. Sono pubblicati pacchetti per Mac Intel (x64) e Apple Silicon (arm64).

Su macOS potrebbero comparire avvisi perché le build non sono notarizzate.

I pacchetti macOS usano una firma ad hoc per mantenere valida l'integrità del bundle anche su Apple Silicon. Questa firma non certifica l'identità dello sviluppatore e non sostituisce la notarizzazione Apple.

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

I pacchetti vengono salvati in dist/. La creazione dei pacchetti macOS richiede macOS; il workflow GitHub Actions usa runner Linux, Windows e macOS per generare automaticamente tutti gli artefatti a ogni tag v*.

## Licenza

Distribuito con licenza MIT. Vedi [LICENSE](LICENSE).
