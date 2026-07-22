#!/usr/bin/env bash
# =============================================================================
# Pubblica la pagina download e il manifest di OcuLauncher sul sito esistente
# minecraft.oculandiavr.it (nginx nel container `oculandia-web`).
# Niente domini nuovi, niente servizi nuovi.
#
#   - /scarica                → pagina download (scarica.html)
#   - /launcher/manifest.json → elenco mod che il launcher scarica a ogni avvio
#
# Da eseguire come root sul VPS, con manifest.json e scarica.html nella stessa
# cartella di questo script.
#
# Se la route Traefik di minecraft.oculandiavr.it limita i percorsi (es. solo
# /regole e /cinema), lo script la estende con /scarica e /launcher.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DYN=/data/coolify/proxy/dynamic

echo "== 1/3 Trovo la docroot di oculandia-web =="
DOCROOT="$(docker inspect oculandia-web --format '{{range .Mounts}}{{.Source}}|{{.Destination}}{{"\n"}}{{end}}' \
  | awk -F'|' '$2 ~ /nginx\/html|\/usr\/share\/nginx|\/var\/www/ {print $1; exit}')"
if [[ -z "$DOCROOT" || ! -d "$DOCROOT" ]]; then
  echo "Docroot non trovata automaticamente. Mount del container:"
  docker inspect oculandia-web --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
  echo "Imposta DOCROOT a mano ed esegui di nuovo."; exit 1
fi
echo "Docroot: $DOCROOT"

echo "== 2/3 Copio pagina e manifest =="
# La pagina: sia con estensione che senza, per rispettare lo stile di /regole.
cp "$HERE/scarica.html" "$DOCROOT/scarica.html"
if [[ -f "$DOCROOT/regole" && ! -f "$DOCROOT/regole.html" ]]; then
  cp "$HERE/scarica.html" "$DOCROOT/scarica"
fi
mkdir -p "$DOCROOT/launcher"
cp "$HERE/manifest.json" "$DOCROOT/launcher/manifest.json"
chmod -R a+rX "$DOCROOT/launcher" "$DOCROOT/scarica.html" 2>/dev/null || true
echo "Copiato. Per aggiornare le mod dei giocatori in futuro: modifica $DOCROOT/launcher/manifest.json"

echo "== 3/3 Verifico la route Traefik =="
ROUTE_FILE="$(grep -rl 'minecraft.oculandiavr.it' "$DYN" 2>/dev/null | head -1 || true)"
if [[ -n "$ROUTE_FILE" ]]; then
  echo "Route: $ROUTE_FILE"
  if grep -q 'PathPrefix' "$ROUTE_FILE" && ! grep -q '/scarica' "$ROUTE_FILE"; then
    cp "$ROUTE_FILE" "$ROUTE_FILE.bak-oculauncher"
    # Estende la prima riga "rule:" con i due nuovi percorsi.
    sed -i "s#\(rule:.*\)PathPrefix(\`/regole\`)#\1PathPrefix(\`/regole\`) || PathPrefix(\`/scarica\`) || PathPrefix(\`/launcher\`)#" "$ROUTE_FILE"
    grep -q '/scarica' "$ROUTE_FILE" \
      && echo "Route estesa con /scarica e /launcher (backup: $ROUTE_FILE.bak-oculauncher)" \
      || echo "ATTENZIONE: non sono riuscito a estendere la rule — aggiungi a mano PathPrefix(\`/scarica\`) e PathPrefix(\`/launcher\`)"
  else
    echo "La route non limita i percorsi (o è già estesa): niente da fare."
  fi
else
  echo "Nessuna route con minecraft.oculandiavr.it in $DYN — se il sito è servito altrove, verifica a mano."
fi

echo
echo "Verifica tra qualche secondo:"
echo "  curl -I https://minecraft.oculandiavr.it/scarica"
echo "  curl -I https://minecraft.oculandiavr.it/launcher/manifest.json"
