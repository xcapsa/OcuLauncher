'use strict';
const fs = require('fs');
const path = require('path');
const { downloadFile, fetchJson } = require('./download');

const VERSION_INDEX = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

async function prepareMinecraftRuntime(gameDir, version, fabricId, javaArch, onStatus) {
  const metadataPath = path.join(gameDir, 'versions', version, `${version}.json`);
  if (!fs.existsSync(metadataPath)) {
    onStatus('Preparo i metadati di Minecraft ' + version + '…');
    const index = await fetchJson(VERSION_INDEX);
    const entry = index.versions.find((item) => item.id === version && item.type === 'release');
    if (!entry) throw new Error('Versione Minecraft non disponibile: ' + version);
    await downloadFile(entry.url, metadataPath, { sha1: entry.sha1 });
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const profileDir = path.join(gameDir, 'versions', fabricId);
  const profile = JSON.parse(fs.readFileSync(path.join(profileDir, fabricId + '.json'), 'utf8'));
  const platform = { darwin: 'osx', win32: 'windows', linux: 'linux' }[process.platform];
  const isArm = javaArch === 'aarch64';
  // Mojang elenca entrambe le architetture per alcuni sistemi. LWJGL deve
  // trovare una sola variante per libreria, scelta in base alla JVM effettiva.
  const libraries = metadata.libraries.filter(({ name }) => {
    const classifier = name.split(':')[3];
    if (!classifier) return true;
    if (classifier.endsWith('-arm64') || classifier.endsWith('-aarch_64')) return isArm;
    if (classifier.endsWith('-x86_64')) return !isArm;
    return !isArm || !metadata.libraries.some((lib) => lib.name === name + '-arm64');
  });
  const versionJson = path.join(profileDir, `mojang-${javaArch}.json`);
  fs.writeFileSync(versionJson, JSON.stringify({ ...metadata, libraries }));

  const logging = metadata.logging.client.file;
  const logj4ConfigurationFile = path.join(gameDir, 'assets', 'log_configs', logging.id);
  if (!fs.existsSync(logj4ConfigurationFile)) {
    await downloadFile(logging.url, logj4ConfigurationFile, { sha1: logging.sha1 });
  }

  const natives = path.join(gameDir, 'natives', version, javaArch);
  const customArgs = [...metadata.arguments.jvm, ...(profile.arguments?.jvm || [])]
    .flatMap((arg) => {
      if (typeof arg === 'string') return [arg];
      if (!arg.rules.some((rule) => rule.action === 'allow'
        && rule.os?.name === platform && !rule.os.arch)) return [];
      // MCLC imposta già HeapDumpPath su Windows.
      return platform === 'windows' ? [] : arg.value;
    })
    .filter((arg) => arg !== '-cp' && arg !== '${classpath}')
    .map((arg) => arg.replaceAll('${natives_directory}', natives)
      .replaceAll('${launcher_name}', 'OcuLauncher')
      .replaceAll('${launcher_version}', require('../../package.json').version));

  return { customArgs, overrides: { versionJson, logj4ConfigurationFile, natives } };
}

module.exports = { prepareMinecraftRuntime };
