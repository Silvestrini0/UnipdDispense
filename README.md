# UniPD Dispense

Applicazione desktop che sincronizza i materiali dei corsi Moodle dell'Università di Padova con una cartella locale, pronta da usare come vault Obsidian.

> Progetto indipendente e non affiliato all'Università degli Studi di Padova.

## Installazione

Scarica l'ultima versione dalla pagina [Releases](https://github.com/Silvestrini0/MoodleScraper/releases/latest). I pacchetti vengono generati per Linux, Windows e macOS quando viene pubblicata una release.

### Linux

- **AppImage:** scarica il file **.AppImage**, rendilo eseguibile dalle proprietà del file oppure esegui chmod +x UniPD-Dispense-*.AppImage, quindi avvialo.
- **Debian e Ubuntu:** scarica il file **.deb** e installalo con sudo apt install ./UniPD-Dispense-*.deb dalla cartella in cui si trova.
- **Fedora e distribuzioni compatibili:** scarica il file **.rpm** e installalo con sudo dnf install ./UniPD-Dispense-*.rpm.
- **Altre distribuzioni:** estrai il pacchetto **.tar.gz** e avvia l'applicazione contenuta nella cartella estratta.

### Windows

Scarica e avvia **UniPD-Dispense-Setup-...-x64.exe** per installare l'app. In alternativa, estrai il file **.zip** ed esegui l'applicazione dalla cartella estratta.

### macOS

Scarica il file **.dmg**, aprilo e trascina l'app in Applicazioni. È disponibile anche un archivio **.zip**. Sono pubblicati pacchetti per Mac Intel (x64) e Apple Silicon (arm64).

Le build non sono firmate con certificati commerciali: Windows o macOS potrebbero mostrare un avviso per un'app scaricata da Internet. Scarica i file solo dalla pagina Releases di questo progetto e, se il sistema lo richiede, autorizza l'apertura dalle impostazioni di sicurezza.

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
