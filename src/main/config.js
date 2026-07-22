'use strict';
// Configurazione centrale di OcuLauncher.
// L'unica cosa che serve cambiare per aggiornare le mod è il manifest sul VPS.

module.exports = {
  APP_NAME: 'OcuLauncher',
  // Manifest remoto: elenco mod + versioni. Servito dal sito Oculandia (nginx oculandia-web).
  MANIFEST_URL: 'https://minecraft.oculandiavr.it/launcher/manifest.json',
  // Timeout per il download del manifest (ms). Se scade si usa l'ultima copia in cache.
  MANIFEST_TIMEOUT: 6000,
  // API Adoptium per scaricare il runtime Java (Temurin JRE).
  ADOPTIUM_API: 'https://api.adoptium.net/v3/assets/latest/{major}/hotspot?os={os}&architecture={arch}&image_type=jre',
  // Meta Fabric per il profilo del loader.
  FABRIC_PROFILE_URL: 'https://meta.fabricmc.net/v2/versions/loader/{mc}/{loader}/profile/json',
  // Sito della community (link nel launcher).
  WEBSITE_URL: 'https://minecraft.oculandiavr.it',
  MAP_URL: 'https://map.oculandiavr.it',
  RULES_URL: 'https://minecraft.oculandiavr.it/regole',
};
