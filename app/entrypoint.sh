#!/bin/sh
# Avvio del container: sistema i permessi della cartella dei dati
# (su ZimaOS e altri sistemi Docker la crea come root) e poi fa girare
# l'app con l'utente "node", senza privilegi di amministratore.
set -e
mkdir -p "${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "${DATA_DIR:-/data}"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
