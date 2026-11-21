#!/bin/sh
# Avvia Tailscale (se configurato) e poi l'app, tutto nello stesso container.
#
# Tailscale gira in modalità "userspace": non servono /dev/net/tun, permessi
# speciali né impostazioni di rete nel container. Pubblica l'app in HTTPS, solo
# nel tailnet, sull'indirizzo https://<TS_HOSTNAME>.<tailnet>.ts.net
#
# Variabili:
#   TS_AUTHKEY   chiave di autenticazione (serve solo al primo avvio)
#   TS_HOSTNAME  nome del dispositivo su Tailscale (predefinito: sicurezza)
#   TS_FUNNEL    lasciare false: questa pagina deve restare solo nel tailnet (predefinito: false)
#   TS_LOG       true = mostra anche i log interni di Tailscale
#   TS_ENABLE    false = non avviare Tailscale

DATA="${DATA_DIR:-/data}"
TS_DIR="$DATA/tailscale"
SOCK=/tmp/tailscaled.sock
HOST="${TS_HOSTNAME:-sicurezza}"
APP_PORT="${PORT:-3000}"

say() { echo "[tailscale] $*"; }
ts() { tailscale --socket="$SOCK" "$@"; }

# Legge dallo stato di Tailscale: "<stato> <indirizzo>"
ts_info() {
  ts status --json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      try { const j = JSON.parse(s); console.log((j.BackendState || "") + " " + ((j.Self && j.Self.DNSName) || "").replace(/\.$/, "")); }
      catch (_) { console.log(""); }
    });'
}
ts_state() { ts_info | cut -d" " -f1; }
ts_addr() { ts_info | cut -d" " -f2; }

configura_tailscale() {
  # aspetta che il demone risponda
  i=0; st=""
  while [ $i -lt 60 ]; do
    st=$(ts_state)
    [ -n "$st" ] && [ "$st" != "NoState" ] && break
    sleep 1; i=$((i + 1))
  done

  if [ "$st" = "NeedsLogin" ] || [ "$st" = "NeedsMachineAuth" ] || [ -z "$st" ] || [ "$st" = "NoState" ]; then
    if [ -z "${TS_AUTHKEY:-}" ]; then
      say "non collegato e TS_AUTHKEY è vuota: aggiungi la chiave nelle impostazioni dell'app e riavviala."
      return 1
    fi
    say "primo collegamento al tailnet come \"$HOST\"..."
    if ! timeout 90 tailscale --socket="$SOCK" up --authkey="$TS_AUTHKEY" --hostname="$HOST" </dev/null; then
      say "collegamento non riuscito: controlla che la chiave sia valida e non già usata."
      return 1
    fi
  else
    ts set --hostname="$HOST" >/dev/null 2>&1 || true
  fi

  # aspetta di essere collegato
  i=0
  while [ $i -lt 60 ] && [ "$(ts_state)" != "Running" ]; do sleep 1; i=$((i + 1)); done
  if [ "$(ts_state)" != "Running" ]; then
    say "non riesco a collegarmi (stato: $(ts_state)). Riprovo al prossimo riavvio."
    return 1
  fi

  # pubblica l'app in HTTPS
  ts serve reset >/dev/null 2>&1 || true
  pubblicata=""
  if [ "${TS_FUNNEL:-false}" = "true" ]; then
    if timeout 45 tailscale --socket="$SOCK" funnel --bg "$APP_PORT" </dev/null >/dev/null 2>&1; then
      say "pubblicata su internet (Funnel): https://$(ts_addr)"
      pubblicata=1
    else
      say "Funnel non disponibile: controlla nelle regole di Tailscale il permesso \"funnel\" per tag:sicurezza. Per ora la pubblico solo nel tailnet."
      ts serve reset >/dev/null 2>&1 || true
    fi
  fi
  if [ -z "$pubblicata" ]; then
    if timeout 45 tailscale --socket="$SOCK" serve --bg "$APP_PORT" </dev/null >/dev/null 2>&1; then
      say "raggiungibile dai dispositivi del tailnet: https://$(ts_addr)"
    else
      say "non riesco ad attivare HTTPS: controlla che in DNS siano attivi MagicDNS e HTTPS Certificates."
    fi
  fi
}

if [ "${TS_ENABLE:-true}" != "false" ] && { [ -n "${TS_AUTHKEY:-}" ] || [ -s "$TS_DIR/tailscaled.state" ]; }; then
  mkdir -p "$TS_DIR"
  if [ "${TS_LOG:-false}" = "true" ]; then
    tailscaled --tun=userspace-networking --statedir="$TS_DIR" --socket="$SOCK" &
  else
    tailscaled --tun=userspace-networking --statedir="$TS_DIR" --socket="$SOCK" >/dev/null 2>&1 &
  fi
  configura_tailscale &
else
  say "non configurato (manca TS_AUTHKEY): l'app è raggiungibile solo dalle porte del container."
fi

exec node --disable-warning=ExperimentalWarning server.js
