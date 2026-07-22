'use strict';
/* global ocu */

const $ = (id) => document.getElementById(id);
let state = null;
let gameState = 'idle';

function setProfile(profile) {
  if (profile) {
    $('account-name').textContent = profile.name;
    $('avatar').textContent = profile.name.charAt(0).toUpperCase();
    $('btn-auth').textContent = 'Esci';
    $('btn-play').disabled = gameState !== 'idle' ? true : false;
  } else {
    $('account-name').textContent = 'Non connesso';
    $('avatar').textContent = '?';
    $('btn-auth').textContent = 'Accedi con Microsoft';
    $('btn-play').disabled = true;
  }
}

function setStatus(text, progress) {
  $('status-line').textContent = text || '';
  $('progress-bar').style.width = progress != null ? Math.min(100, Math.round(progress * 100)) + '%' : '0%';
}

function renderMods(manifest, vrMode) {
  const list = $('mod-list');
  list.innerHTML = '';
  let count = 0;
  for (const mod of manifest.mods) {
    const isVr = (mod.tags || []).includes('vr');
    const li = document.createElement('li');
    li.textContent = mod.name;
    if (isVr) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'VR';
      li.appendChild(tag);
      if (!vrMode) li.style.opacity = '0.4';
      else count++;
    } else count++;
    list.appendChild(li);
  }
  $('mod-count').textContent = `(${count} attive)`;
}

const CATEGORY_LABELS = { grafica: '🎨 Grafica e shader', animazioni: '🏃 Animazioni e modelli', audio: '🔊 Audio realistico', mondo: '🌍 Mondo (per PC potenti)' };

function renderExtras() {
  const list = $('extras-list');
  list.innerHTML = '';
  const selected = new Set(state.settings.extraMods || []);
  const mods = state.manifest.optionalMods || [];
  $('extras-card').style.display = mods.length ? '' : 'none';
  const byCat = {};
  for (const m of mods) (byCat[m.category] = byCat[m.category] || []).push(m);

  for (const cat of ['grafica', 'animazioni', 'audio', 'mondo']) {
    if (!byCat[cat]) continue;
    const title = document.createElement('div');
    title.className = 'extras-group-title';
    title.textContent = CATEGORY_LABELS[cat] || cat;
    list.appendChild(title);
    for (const m of byCat[cat]) {
      const label = document.createElement('label');
      label.className = 'extra-item' + (selected.has(m.slug) ? ' checked' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(m.slug);
      cb.dataset.slug = m.slug;
      cb.addEventListener('change', () => toggleExtra(m, cb.checked));
      const txt = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'extra-name';
      name.textContent = m.name;
      if (m.heavy) name.insertAdjacentHTML('beforeend', '<span class="badge badge-heavy">PESANTE</span>');
      if (m.type !== 'mod') name.insertAdjacentHTML('beforeend', `<span class="badge badge-type">${m.type === 'shaderpack' ? 'SHADER' : 'RISORSE'}</span>`);
      const desc = document.createElement('div');
      desc.className = 'extra-desc';
      desc.textContent = m.desc + (m.sizeMB ? ` · ${m.sizeMB} MB` : '');
      txt.append(name, desc);
      label.append(cb, txt);
      list.appendChild(label);
    }
  }
  const totMB = mods.filter((m) => selected.has(m.slug)).reduce((a, m) => a + (m.sizeMB || 0), 0);
  $('extras-size').textContent = selected.size ? `— ${selected.size} attive (~${totMB} MB)` : '';
}

async function saveExtras(slugs) {
  state.settings = await ocu.setSettings({ extraMods: slugs });
  renderExtras();
  updateAutoRamLabel();
}

function toggleExtra(mod, on) {
  const sel = new Set(state.settings.extraMods || []);
  if (on) {
    sel.add(mod.slug);
    for (const req of mod.requires || []) sel.add(req); // dipendenze (es. Fresh Animations → EMF+ETF)
  } else {
    sel.delete(mod.slug);
  }
  saveExtras([...sel]);
}

async function updateAutoRamLabel() {
  const auto = await ocu.getAutoRam();
  $('ram-auto-label').textContent = `(${(auto / 1024).toFixed(1)} GB su questo PC)`;
}

async function refreshPing() {
  const r = await ocu.pingServer();
  const el = $('server-status');
  if (r && r.online) {
    el.innerHTML = '<span class="dot dot-green"></span> Online';
    $('server-players').textContent = r.players
      ? `${r.players.online}/${r.players.max} giocatori · ${r.latencyMs} ms`
      : `${r.latencyMs} ms`;
  } else {
    el.innerHTML = '<span class="dot dot-red"></span> Offline';
    $('server-players').textContent = '';
  }
}

async function init() {
  state = await ocu.getState();
  const s = state.settings;

  $('launcher-version').textContent = `OcuLauncher v${state.version}`;
  $('mc-version').textContent = `Minecraft ${state.manifest.minecraft} · Fabric ${state.manifest.fabricLoader}`;
  $('news').textContent = state.manifest.news || 'Nessuna novità.';
  if (state.manifest.server) {
    $('server-address').textContent = `${state.manifest.server.host}`;
  }
  renderMods(state.manifest, s.vrMode);

  $('ram').value = s.ramMB;
  $('ram-label').textContent = (s.ramMB / 1024).toFixed(1) + ' GB';
  $('ram-auto').checked = s.ramAuto !== false;
  $('ram-manual-row').classList.toggle('hidden', s.ramAuto !== false);
  $('vr-mode').checked = !!s.vrMode;
  $('keep-open').checked = !!s.keepOpen;
  renderExtras();
  updateAutoRamLabel();

  setProfile(null);
  setStatus('Accesso in corso…');
  const profile = await ocu.silentLogin();
  if (profile) {
    setProfile(profile);
    setStatus('Bentornato, ' + profile.name + '!');
  } else {
    setStatus('Accedi con il tuo account Microsoft per giocare.');
  }

  refreshPing();
  setInterval(refreshPing, 30000);
}

/* ---- Eventi UI ---- */

$('btn-auth').addEventListener('click', async () => {
  if ($('btn-auth').textContent === 'Esci') {
    await ocu.logout();
    setProfile(null);
    setStatus('Sei uscito dall\'account.');
    return;
  }
  $('btn-auth').disabled = true;
  setStatus('Apro la finestra di login Microsoft…');
  const r = await ocu.login();
  $('btn-auth').disabled = false;
  if (r.ok) {
    setProfile(r.profile);
    setStatus('Ciao ' + r.profile.name + '! Premi GIOCA quando vuoi.');
  } else {
    setStatus('Login annullato o non riuscito. ' + (r.error || ''));
  }
});

$('btn-play').addEventListener('click', async () => {
  $('btn-play').disabled = true;
  const r = await ocu.play();
  if (!r.ok) {
    setStatus('Errore: ' + r.error);
    $('btn-play').disabled = false;
  }
});

$('ram').addEventListener('input', () => {
  $('ram-label').textContent = ($('ram').value / 1024).toFixed(1) + ' GB';
});
$('ram').addEventListener('change', () => ocu.setSettings({ ramMB: Number($('ram').value) }));

$('ram-auto').addEventListener('change', async () => {
  const on = $('ram-auto').checked;
  state.settings = await ocu.setSettings({ ramAuto: on });
  $('ram-manual-row').classList.toggle('hidden', on);
  if (on) updateAutoRamLabel();
});

$('extras-recommended').addEventListener('click', () => {
  const slugs = (state.manifest.optionalMods || []).filter((m) => !m.heavy).map((m) => m.slug);
  saveExtras(slugs);
  setStatus('Attivate le mod immersive consigliate: verranno installate al prossimo GIOCA.');
});
$('extras-none').addEventListener('click', () => {
  saveExtras([]);
  setStatus('Mod extra disattivate: al prossimo avvio resterà il pacchetto base.');
});

$('vr-mode').addEventListener('change', async () => {
  const st = await ocu.setSettings({ vrMode: $('vr-mode').checked });
  renderMods(state.manifest, st.vrMode);
  setStatus(st.vrMode
    ? 'Modalità VR attiva: al prossimo avvio verrà installato Vivecraft.'
    : 'Modalità VR disattivata.');
});

$('keep-open').addEventListener('change', () => ocu.setSettings({ keepOpen: $('keep-open').checked }));

document.querySelectorAll('.ext-link').forEach((a) => {
  a.addEventListener('click', (ev) => {
    ev.preventDefault();
    ocu.openExternal(state.links[a.dataset.link]);
  });
});
$('open-folder').addEventListener('click', (ev) => { ev.preventDefault(); ocu.openGameFolder(); });

/* ---- Eventi dal main ---- */

ocu.onStatus(({ text, progress }) => setStatus(text, progress));
ocu.onGameState((gs) => {
  gameState = gs;
  if (gs === 'idle') {
    $('btn-play').disabled = false;
    $('btn-play').textContent = 'GIOCA';
    $('progress-bar').style.width = '0%';
  } else if (gs === 'preparing') {
    $('btn-play').disabled = true;
    $('btn-play').textContent = 'PREPARO…';
  } else if (gs === 'running') {
    $('btn-play').disabled = true;
    $('btn-play').textContent = 'IN GIOCO';
  }
});

init().catch((e) => setStatus('Errore di avvio: ' + e.message));
