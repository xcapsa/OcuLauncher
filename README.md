# OcuLauncher 🥽

Il launcher ufficiale di **Oculandia VR**: un unico programma per Windows e Mac che installa e avvia Minecraft **nella versione giusta** (1.21.5 + Fabric) **con tutte le mod giuste**, automaticamente. I giocatori devono solo: installare, fare login Microsoft, premere **GIOCA**.

## Cosa fa per il giocatore

1. **Login Microsoft** (una sola volta, poi resta collegato).
2. Scarica da solo **Java 21**, **Minecraft 1.21.5**, **Fabric 0.19.3** e le **mod del server** (Fabric API, Sodium, Lithium, FerriteCore, ImmediatelyFast, Entity Culling, Simple Voice Chat — e Vivecraft se attivi la **Modalità VR**).
3. **Esperienza immersiva a scelta**: 19 mod extra curate tra le più scaricate di Modrinth (shader Iris + Complementary, Fresh Animations, suoni realistici, Distant Horizons, Physics Mod…), attivabili con una spunta nel launcher — dipendenze risolte automaticamente, shader e resource pack scaricati nelle cartelle giuste.
4. **Memoria automatica**: il launcher calcola da solo la RAM giusta in base al PC (metà della totale, 3–8 GB, fino a 12 GB con le mod pesanti), oppure regolazione manuale con lo slider.
5. Verifica i file (checksum SHA-1) e **si tiene aggiornato**: la lista mod arriva da `https://minecraft.oculandiavr.it/launcher/manifest.json`, quindi quando aggiorni il server basta cambiare quel file e tutti i giocatori ricevono le mod nuove al prossimo avvio.
6. Entra **direttamente nel server** `minecraft.oculandiavr.it` (Quick Play).
7. Tutto in una cartella separata (`%APPDATA%/OcuLauncher` su Windows, `~/Library/Application Support/OcuLauncher` su Mac): non tocca il Minecraft "normale" del giocatore.
8. Il launcher **si aggiorna da solo** tramite le GitHub Releases (Windows; su Mac senza firma Apple l'auto-update non è possibile, si riscarica il .dmg).

## Pagina di download con auto-riconoscimento

`server/scarica.html` è la pagina "Scarica OcuLauncher" nello stesso stile del sito: rileva il sistema del visitatore (Windows/Windows ARM/Mac Intel/Mac Apple Silicon), propone il download giusto con un pulsante grande e mostra comunque tutte e 4 le versioni, con link presi automaticamente dall'ultima Release GitHub. Lo script `setup-vps.sh` la pubblica su `https://minecraft.oculandiavr.it/scarica`, dentro il sito che già serve /regole — nessun dominio nuovo. **Ricorda di sostituire `OCULANDIA_GITHUB_USER` anche in `scarica.html`** (riga `const REPO`).

## Come pubblicare la prima release (una volta sola)

1. Crea un account/repo GitHub, ad es. `TUduo/OcuLauncher` (può essere privato¹ o pubblico — **pubblico consigliato**: Actions gratuite e release scaricabili da tutti).
2. In `package.json` sostituisci `OCULANDIA_GITHUB_USER` con il tuo username GitHub.
3. Poi, dalla cartella del progetto:
   ```bash
   git init
   git add .
   git commit -m "OcuLauncher 1.0.0"
   git branch -M main
   git remote add origin https://github.com/TUO_USERNAME/OcuLauncher.git
   git push -u origin main
   git tag v1.0.0
   git push origin v1.0.0        # ← questo fa partire la build
   ```
4. Su GitHub → **Actions** vedi la build (≈10 min). A fine corsa in **Releases** trovi:
   - `OcuLauncher-Setup-1.0.0-win-x64.exe` — Windows normale (Intel/AMD)
   - `OcuLauncher-Setup-1.0.0-win-arm64.exe` — Windows ARM (Surface, Snapdragon)
   - `OcuLauncher-1.0.0-mac-x64.dmg` — Mac Intel
   - `OcuLauncher-1.0.0-mac-arm64.dmg` — Mac Apple Silicon (M1/M2/M3/M4)

Per le versioni successive: alza `version` in `package.json`, commit, nuovo tag `v1.0.1`, push del tag. I launcher Windows installati si aggiornano da soli.

¹ Se il repo è privato le release non sono scaricabili pubblicamente e l'auto-update non funziona: meglio pubblico.

## Avvisi di sicurezza (app non firmata)

Non avendo certificati a pagamento (Apple Developer ~99 €/anno, certificato Windows ~200-400 €/anno):

- **Windows**: SmartScreen mostra "PC protetto da Windows" → dire ai giocatori: **Ulteriori informazioni → Esegui comunque**.
- **macOS**: al primo avvio l'app viene bloccata. Su macOS 15+ (Sequoia): aprire **Impostazioni di Sistema → Privacy e Sicurezza**, scorrere in basso e premere **"Apri comunque"**. Su versioni precedenti basta **clic destro sull'app → Apri → Apri**. Se macOS dice che l'app è "danneggiata": Terminale → `xattr -cr /Applications/OcuLauncher.app`.

Conviene scrivere questi due passaggi nella pagina di download / messaggio Telegram.

## Il manifest sul VPS

- File d'esempio già pronto: [`server/manifest.json`](server/manifest.json).
- Setup sul VPS: copia la cartella `server/` sul VPS ed esegui `bash setup-vps.sh` come root — pubblica pagina e manifest dentro il sito esistente (nginx `oculandia-web`), senza DNS o servizi nuovi.
- **Aggiornare le mod di tutti**: modifica `launcher/manifest.json` nella docroot di oculandia-web (lo script te la stampa) (aggiungi/togli voci in `mods`, con `url` e `sha1` presi da Modrinth). I giocatori ricevono le modifiche al riavvio del launcher.
- Se il VPS è irraggiungibile il launcher usa l'ultima copia in cache (o quella inclusa), quindi non blocca mai nessuno.
- La voce con `"tags": ["vr"]` (Vivecraft) viene installata solo a chi attiva la Modalità VR.

## Sviluppo locale

```bash
npm install
npm start          # avvia il launcher in sviluppo
npm run dist:win   # build Windows (funziona anche da Linux/CI)
npm run dist:mac   # build macOS (solo su un Mac o su CI macOS)
```

Struttura: `src/main/` processo principale (auth Microsoft, download Java/Fabric/mod, avvio gioco, ping server), `src/preload.js` ponte IPC, `src/renderer/` interfaccia, `server/` file per il VPS, `.github/workflows/build.yml` build automatiche.

## Note tecniche

- Login: [msmc](https://github.com/Hanro50/MSMC) (flusso Microsoft ufficiale, il token resta solo sul PC del giocatore).
- Avvio: [minecraft-launcher-core](https://github.com/Pierce01/MinecraftLauncher-core) con profilo Fabric da meta.fabricmc.net.
- Java: Temurin 21 JRE da api.adoptium.net, scaricato per l'architettura giusta (su Windows ARM senza build nativa usa x64 in emulazione).
- Icona: quella ufficiale Oculandia (1024px, da `icon.iconset`), usata sia per l'app che nell'interfaccia.
