'use strict';
// Controllo aggiornamenti "manuale" via GitHub Releases.
// Si usa dove electron-updater non può installare da solo:
// - macOS senza firma Apple (Squirrel richiede un'app firmata da un
//   Developer ID: la nostra firma ad-hoc non basta per l'auto-install);
// - edizione Staff: le release staff sono PRE-release, mentre
//   electron-updater punterebbe alla "latest" pubblica e trasformerebbe
//   il launcher Staff in quello pubblico.
const download = require('./download');

const RELEASES_URL = 'https://api.github.com/repos/{repo}/releases?per_page=30';

/** "v1.0.4" / "1.0.3-staff" → "1.0.4" / "1.0.3" (solo i numeri X.Y.Z). */
function baseVersion(v) {
  return String(v || '').replace(/^v/i, '').replace(/-staff$/i, '');
}

/** >0 se a è più nuova di b, 0 se uguali, <0 se più vecchia. */
function compareVersions(a, b) {
  const pa = baseVersion(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = baseVersion(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Suffisso del nome dell'installer giusto per questa macchina. */
function assetSuffix(platform, arch) {
  const a = arch === 'arm64' ? 'arm64' : 'x64';
  return platform === 'darwin' ? `mac-${a}.dmg` : `win-${a}.exe`;
}

/**
 * Cerca un aggiornamento per l'edizione giusta.
 * Ritorna null se si è già all'ultima versione, altrimenti
 * { version, tag, url } — url è l'installer per questa piattaforma
 * (o la pagina della release, se l'asset non si trova).
 */
async function findUpdate({ repo, staff, currentVersion, platform = process.platform, arch = process.arch }) {
  const releases = await download.fetchJson(RELEASES_URL.replace('{repo}', repo));
  const rel = (releases || []).find((r) => r && !r.draft && (staff
    ? (r.prerelease && /-staff$/i.test(r.tag_name || ''))
    : !r.prerelease));
  if (!rel) return null;
  if (compareVersions(rel.tag_name, currentVersion) <= 0) return null;
  const suffix = assetSuffix(platform, arch);
  const asset = (rel.assets || []).find((x) => x.name && x.name.toLowerCase().endsWith(suffix));
  return {
    version: baseVersion(rel.tag_name),
    tag: rel.tag_name,
    url: asset ? asset.browser_download_url : rel.html_url,
  };
}

module.exports = { findUpdate, compareVersions, baseVersion, assetSuffix };
