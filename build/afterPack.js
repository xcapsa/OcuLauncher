'use strict';
// Firma "ad-hoc" locale dell'app macOS (senza account Apple a pagamento).
// Su Apple Silicon un'app non firmata dà l'errore "è danneggiata e non può
// essere aperta". La firma ad-hoc elimina quel blocco: resta solo il normale
// avviso Gatekeeper, che l'utente supera con clic destro → Apri (una volta).
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log('[afterPack] firma ad-hoc di', appPath);
  // --deep firma anche i componenti interni; --sign - = identità ad-hoc.
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  // Verifica che la firma sia valida.
  execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: 'inherit' });
  console.log('[afterPack] firma ad-hoc completata');
};
