'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Client } = require('minecraft-launcher-core');
const extractZip = require('extract-zip');
const tar = require('tar');
const nbt = require('prismarine-nbt');
const config = require('./config');
const { downloadFile, fileSha1, fetchJson } = require('./download');

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

/**
 * Scarica il manifest dal VPS. Se non raggiungibile usa, nell'ordine:
 * l'ultima copia scaricata (cache) e infine quella inclusa nel launcher.
 */
async function getManifest(gameDir) {
  const cacheFile = path.join(gameDir, 'manifest-cache.json');
  try {
    const m = await fetchJson(config.MANIFEST_URL, config.MANIFEST_TIMEOUT);
    if (!m || !Array.isArray(m.mods)) throw new Error('manifest non valido');
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(m, null, 2));
    return { manifest: m, source: 'remote' };
  } catch (e) {
    console.warn('Manifest remoto non disponibile:', e.message);
    try {
      return { manifest: JSON.parse(fs.readFileSync(cacheFile, 'utf8')), source: 'cache' };
    } catch (_) {
      return { manifest: require('../shared/default-manifest.json'), source: 'bundled' };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Java (Temurin JRE)                                                  */
/* ------------------------------------------------------------------ */

function javaPlatform() {
  const osName = process.platform === 'win32' ? 'windows'
    : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  return { osName, arch };
}

function findJavaExecutable(rootDir) {
  // Cerca bin/java(.exe) dentro la cartella estratta (su macOS sta in Contents/Home).
  const exe = process.platform === 'win32' ? 'javaw.exe' : 'java';
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.name === exe && path.basename(dir) === 'bin') return full;
    }
  }
  return null;
}

/**
 * Garantisce la presenza di un JRE Temurin della major richiesta.
 * Ritorna il percorso dell'eseguibile java.
 */
async function ensureJava(gameDir, javaMajor, onStatus) {
  const { osName, arch } = javaPlatform();
  const runtimeDir = path.join(gameDir, 'runtime', `temurin-${javaMajor}-${arch}`);
  const markerFile = path.join(runtimeDir, '.ok');

  if (fs.existsSync(markerFile)) {
    const cached = findJavaExecutable(runtimeDir);
    if (cached) return cached;
  }

  onStatus('Preparo Java ' + javaMajor + '…');
  const apiUrl = config.ADOPTIUM_API
    .replace('{major}', javaMajor).replace('{os}', osName).replace('{arch}', arch);

  let assets = [];
  try { assets = await fetchJson(apiUrl); } catch (e) { console.warn('Adoptium:', e.message); }
  if (!assets.length && arch === 'aarch64') {
    // Fallback: su Windows ARM senza build native si usa x64 in emulazione.
    onStatus('Java nativo ARM non trovato, uso la versione x64…');
    try {
      assets = await fetchJson(config.ADOPTIUM_API
        .replace('{major}', javaMajor).replace('{os}', osName).replace('{arch}', 'x64'));
    } catch (e) { console.warn('Adoptium fallback:', e.message); }
  }
  if (!assets.length) throw new Error('Impossibile trovare un runtime Java da scaricare. Controlla la connessione.');

  const pkg = assets[0].binary.package;
  const archive = path.join(gameDir, 'runtime', pkg.name);
  onStatus('Scarico Java (' + Math.round(pkg.size / 1e6) + ' MB)…');
  await downloadFile(pkg.link, archive, {
    onProgress: (done, total) => onStatus('Scarico Java… ' + Math.round((done / total) * 100) + '%', done / total),
  });

  onStatus('Estraggo Java…');
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  if (pkg.name.endsWith('.zip')) {
    await extractZip(archive, { dir: runtimeDir });
  } else {
    await tar.x({ file: archive, cwd: runtimeDir });
  }
  fs.rmSync(archive, { force: true });

  const javaExe = findJavaExecutable(runtimeDir);
  if (!javaExe) throw new Error('Runtime Java estratto ma eseguibile non trovato.');
  if (process.platform !== 'win32') fs.chmodSync(javaExe, 0o755);
  fs.writeFileSync(markerFile, new Date().toISOString());
  return javaExe;
}

/* ------------------------------------------------------------------ */
/* Fabric                                                              */
/* ------------------------------------------------------------------ */

/** Installa il profilo Fabric (versions/<id>/<id>.json) e ritorna l'id versione. */
async function ensureFabric(gameDir, mcVersion, loaderVersion, onStatus) {
  const id = `fabric-loader-${loaderVersion}-${mcVersion}`;
  const dir = path.join(gameDir, 'versions', id);
  const file = path.join(dir, id + '.json');
  if (!fs.existsSync(file)) {
    onStatus('Preparo Fabric ' + loaderVersion + '…');
    const url = config.FABRIC_PROFILE_URL.replace('{mc}', mcVersion).replace('{loader}', loaderVersion);
    const profile = await fetchJson(url);
    profile.id = id;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(profile, null, 2));
  }
  return id;
}

/* ------------------------------------------------------------------ */
/* Mod                                                                 */
/* ------------------------------------------------------------------ */

function modApplies(mod, vrMode) {
  const tags = mod.tags || [];
  if (tags.includes('vr') && !vrMode) return false;
  return true;
}

/** Espande la selezione di mod opzionali con i loro `requires`. */
function expandExtraSelection(manifest, extraSlugs) {
  const bySlug = new Map((manifest.optionalMods || []).map((m) => [m.slug, m]));
  const selected = new Set();
  const queue = [...(extraSlugs || [])];
  while (queue.length) {
    const slug = queue.shift();
    const entry = bySlug.get(slug);
    if (!entry || selected.has(slug)) continue;
    selected.add(slug);
    for (const req of entry.requires || []) queue.push(req);
  }
  return [...selected].map((s) => bySlug.get(s));
}

const SUBDIR_BY_TYPE = { mod: 'mods', shaderpack: 'shaderpacks', resourcepack: 'resourcepacks' };

/**
 * Sincronizza mod (obbligatorie + opzionali scelte), shaderpack e resourcepack.
 * - mods/: cartella gestita interamente dal launcher (i jar non previsti si rimuovono)
 * - shaderpacks/ e resourcepacks/: si gestiscono SOLO i file elencati nel manifest
 *   (quelli aggiunti a mano dal giocatore non si toccano)
 */
async function syncMods(gameDir, manifest, settings, onStatus) {
  const extras = expandExtraSelection(manifest, settings.extraMods);

  // Elenco piatto di file voluti: [{filename,url,sha1,size,dir,label}]
  const wantedFiles = new Map(); // filename -> file (dedup di dipendenze comuni)
  for (const mod of manifest.mods.filter((m) => modApplies(m, settings.vrMode))) {
    wantedFiles.set(mod.filename, { ...mod, dir: 'mods', label: mod.name });
  }
  for (const entry of extras) {
    const dir = SUBDIR_BY_TYPE[entry.type] || 'mods';
    for (const f of entry.files) {
      if (!wantedFiles.has(f.filename)) {
        wantedFiles.set(f.filename, { ...f, dir, label: entry.name });
      }
    }
  }

  // File del manifest che NON sono selezionati: da rimuovere se presenti.
  const managedUnwanted = [];
  for (const entry of manifest.optionalMods || []) {
    const dir = SUBDIR_BY_TYPE[entry.type] || 'mods';
    for (const f of entry.files) {
      if (!wantedFiles.has(f.filename)) managedUnwanted.push({ filename: f.filename, dir });
    }
  }

  // mods/: rimuovi ogni jar non voluto. Altre cartelle: solo i file gestiti.
  const modsDir = path.join(gameDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  // Mod aggiunte dal giocatore: jar in mods-custom/ (incluse ma NON gestite/verificate).
  const customDir = path.join(gameDir, 'mods-custom');
  fs.mkdirSync(customDir, { recursive: true });
  const customJars = settings.customMods === false ? []
    : fs.readdirSync(customDir).filter((f) => f.endsWith('.jar'));
  const customSet = new Set(customJars);
  for (const f of fs.readdirSync(modsDir)) {
    if (f.endsWith('.jar') && !(wantedFiles.has(f) && wantedFiles.get(f).dir === 'mods') && !customSet.has(f)) {
      onStatus('Rimuovo mod non più prevista: ' + f);
      fs.rmSync(path.join(modsDir, f), { force: true });
    }
  }
  // Copia le mod del giocatore in mods/ (le mod gestite hanno la precedenza sul nome file).
  for (const jar of customJars) {
    if (wantedFiles.has(jar)) continue;
    try { fs.copyFileSync(path.join(customDir, jar), path.join(modsDir, jar)); }
    catch (e) { console.warn('Copia mod utente', jar, e.message); }
  }
  for (const { filename, dir } of managedUnwanted) {
    if (dir === 'mods') continue; // già gestito sopra
    const p = path.join(gameDir, dir, filename);
    if (fs.existsSync(p)) {
      onStatus('Rimuovo ' + filename);
      fs.rmSync(p, { force: true });
    }
  }

  const files = [...wantedFiles.values()];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const dest = path.join(gameDir, f.dir, f.filename);
    const label = `${i + 1}/${files.length}: ${f.label}`;
    if (fs.existsSync(dest)) {
      if (!f.sha1 || (await fileSha1(dest)) === f.sha1.toLowerCase()) continue;
      fs.rmSync(dest, { force: true });
    }
    onStatus('Scarico ' + label + '…');
    await downloadFile(f.url, dest, {
      sha1: f.sha1,
      onProgress: (done, total) => onStatus(label + ' — ' + Math.round((done / total) * 100) + '%', (i + done / total) / files.length),
    });
  }
  onStatus('Contenuti aggiornati (' + files.length + ' file)');
}

/* ------------------------------------------------------------------ */
/* RAM automatica                                                      */
/* ------------------------------------------------------------------ */

/**
 * Calcola la RAM per il gioco in base a quella del PC.
 * Regola: metà della RAM totale, tra 3 e 8 GB (fino a 12 GB se sono
 * selezionate mod "pesanti" tipo Distant Horizons o Physics Mod).
 */
function computeAutoRam(manifest, extraSlugs) {
  const totalMB = Math.round(os.totalmem() / (1024 * 1024));
  const selected = new Set(extraSlugs || []);
  const heavy = (manifest.optionalMods || []).some((m) => m.heavy && selected.has(m.slug));
  const cap = heavy ? 12288 : 8192;
  let ram = Math.round(totalMB / 2);
  ram = Math.max(3072, Math.min(cap, ram));
  ram = Math.min(ram, Math.max(2048, totalMB - 2048)); // lascia respiro al sistema
  return Math.round(ram / 512) * 512;
}

/* ------------------------------------------------------------------ */
/* Pre-seed del primo avvio                                            */
/* ------------------------------------------------------------------ */

/**
 * Al PRIMISSIMO avvio prepara due file in gameDir, e SOLO se non esistono
 * già (mai sovrascrivere avvii successivi o modifiche fatte dal giocatore):
 * - options.txt  → narratore spento + lingua italiana (senza questo file
 *   Minecraft può partire col narrator attivo, in inglese);
 * - servers.dat  → il server Oculandia salvato in Multiplayer, così resta
 *   visibile quando il giocatore esce dal server e rientra da solo.
 *   (Il Quick Play di launchGame non scrive mai su servers.dat.)
 * Qualsiasi errore qui non deve bloccare l'avvio del gioco.
 */
function ensureOculandiaServer(gameDir, manifest) {
  // Assicura che il server Oculandia sia sempre nella lista multiplayer (servers.dat),
  // aggiungendolo se manca senza toccare gli altri server aggiunti dal giocatore.
  try {
    if (!manifest || !manifest.server || !manifest.server.host) return;
    const serversFile = path.join(gameDir, 'servers.dat');
    const host = String(manifest.server.host);
    const srvName = String((manifest.server && manifest.server.name) || 'Oculandia VR');
    let items = [];
    if (fs.existsSync(serversFile)) {
      try {
        const parsed = nbt.parseUncompressed(fs.readFileSync(serversFile), 'big');
        const arr = parsed && parsed.value && parsed.value.servers && parsed.value.servers.value && parsed.value.servers.value.value;
        if (Array.isArray(arr)) items = arr;
      } catch (e) { items = []; }
    }
    if (items.some((it) => it && it.ip && String(it.ip.value) === host)) return;
    items.unshift({ name: { type: 'string', value: srvName }, ip: { type: 'string', value: host } });
    const root = { type: 'compound', name: '', value: { servers: { type: 'list', value: { type: 'compound', value: items } } } };
    fs.writeFileSync(serversFile, nbt.writeUncompressed(root, 'big'));
  } catch (e) { console.warn('ensureOculandiaServer:', e && e.message); }
}

function seedGameFiles(gameDir, manifest) {
  fs.mkdirSync(gameDir, { recursive: true });

  // options.txt (testo semplice "chiave:valore", una riga per opzione)
  try {
    const optionsFile = path.join(gameDir, 'options.txt');
    if (!fs.existsSync(optionsFile)) {
      fs.writeFileSync(optionsFile, 'narrator:0\nlang:it_it\n');
    }
  } catch (e) { console.warn('Pre-seed options.txt:', e.message); }

  // servers.dat (NBT binario big-endian, NON compresso)
  try {
    const serversFile = path.join(gameDir, 'servers.dat');
    if (!fs.existsSync(serversFile) && manifest.server && manifest.server.host) {
      const host = manifest.server.host;
      const port = manifest.server.port || 25565;
      const ip = port === 25565 ? host : `${host}:${port}`;
      const root = nbt.comp({
        servers: nbt.list(nbt.comp([{
          name: nbt.string(manifest.server.name || 'Oculandia VR'),
          ip: nbt.string(ip),
        }])),
      }, '');
      fs.writeFileSync(serversFile, nbt.writeUncompressed(root, 'big'));
    }
  } catch (e) { console.warn('Pre-seed servers.dat:', e.message); }
}

/* ------------------------------------------------------------------ */
/* Avvio del gioco                                                     */
/* ------------------------------------------------------------------ */

/**
 * Prepara tutto (java, fabric, mod) e avvia Minecraft.
 * Ritorna l'EventEmitter di minecraft-launcher-core.
 */
async function launchGame({ gameDir, manifest, authorization, settings, onStatus }) {
  seedGameFiles(gameDir, manifest); // solo al primissimo avvio (file mancanti)
  ensureOculandiaServer(gameDir, manifest); // ogni avvio: ripristina Oculandia se sparito
  const javaExe = await ensureJava(gameDir, manifest.javaMajor || 21, onStatus);
  const versionId = await ensureFabric(gameDir, manifest.minecraft, manifest.fabricLoader, onStatus);
  await syncMods(gameDir, manifest, settings, onStatus);

  onStatus('Verifico i file di Minecraft ' + manifest.minecraft + '…');
  const launcher = new Client();
  const maxRam = settings.ramAuto
    ? computeAutoRam(manifest, settings.extraMods)
    : Math.max(2048, settings.ramMB | 0);
  onStatus(`Memoria di gioco: ${(maxRam / 1024).toFixed(1)} GB (${settings.ramAuto ? 'automatica' : 'manuale'})`);
  const opts = {
    authorization,
    root: gameDir,
    javaPath: javaExe,
    version: {
      number: manifest.minecraft,
      type: 'release',
      custom: versionId,
    },
    memory: {
      max: `${maxRam}M`,
      min: `${Math.min(2048, maxRam)}M`,
    },
    overrides: {
      // Il gioco sopravvive se il giocatore chiude il launcher.
      detached: true,
    },
  };
  // Entra direttamente nel server Oculandia (Quick Play, MC 1.20+).
  if (manifest.server && manifest.server.host && settings.autoJoin !== false) {
    opts.quickPlay = {
      type: 'multiplayer',
      identifier: `${manifest.server.host}:${manifest.server.port || 25565}`,
    };
  }
  launcher.launch(opts);
  return launcher;
}

module.exports = { getManifest, ensureJava, ensureFabric, syncMods, seedGameFiles, launchGame, javaPlatform, computeAutoRam };
