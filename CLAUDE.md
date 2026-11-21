# Note per Claude: Sicurezza di casa

Pagina di Fabio con lo stato della sicurezza della sua rete e del suo sistema (ZimaBlade + VPS + tailnet). Tutta l'interfaccia, i messaggi e i commenti sono in **italiano**, e così vanno le risposte a Fabio. Fabio non è uno sviluppatore: spiegagli le cose in modo semplice, con i passaggi da fare nell'interfaccia (GitHub, ZimaOS, Tailscale).

Lo stato del lavoro è in `HANDOFF.md`: leggilo all'inizio e aggiornalo alla fine.

## Regole fisse (non cambiarle senza l'OK esplicito di Fabio)

- **Solo tailnet, solo proprietario**: `TS_FUNNEL=false`, nessun dominio pubblico, `ownerOf()` come nelle altre app (`Tailscale-User-Login` accettato solo da 127.0.0.1, mai con `Tailscale-Funnel-Request`). Chi non è il proprietario riceve `riservata.html` (403) e le API rispondono 403.
- **Nessun segreto** né nel file di stato né nella pagina: mai password, chiavi, token, codici di recupero. Solo stati («password lunga: sì/no»).
- **Nessun potere**: il sito non ha accesso a Docker, alla ZimaBlade, alla VPS, a GitHub. Legge il file di stato (montato `:ro`) e fa controlli da internet in sola lettura.
- **Porte della posta mai provate** (`PORTE_MAI` in `controlli.js`: 25, 110, 143, 465, 587, 993, 995, 4190): l'auto-ban di Stalwart bloccherebbe l'indirizzo di casa. Non togliere questo filtro.
- Pulsante «Controlla adesso»: solo proprietario, intestazione CSRF `X-SC: 1`, al massimo un controllo al minuto (`ATTESA_CONTROLLI_MS`).

## Com'è fatta

- `app/server.js`: Node 22 + Express 5. API: `GET /api/salute` (tutti), `GET /api/stato` (file di stato + ultimi controlli + stato del controllo in corso), `GET /api/controllo` (avanzamento), `POST /api/controlla` (202, 409 se in corso, 429 se meno di un minuto). Pagine: `/` (`index.html` o `riservata.html`), `/risorse/` (CSS e JS). CSP `script-src 'self'`: niente script inline.
- `app/controlli.js`: i quattro passi (`PASSI`), `convalida()` della configurazione, `problemiDi()` e `testoEsito()` (frasi in italiano, confronto con il controllo precedente: novità e cose tornate a posto). Risultati in `/data/controlli.json` (con `storico` degli ultimi 90).
- Controllo automatico ogni giorno all'ora `CONTROLLO_ORA` (ora italiana) se non ce n'è già stato uno dopo quell'ora; all'avvio se l'ultimo ha più di 26 ore.
- `app/public/index.html` + `risorse/app.js` + `risorse/stile.css`: nati dalla bozza approvata da Fabio il 21/11/2026 (menu a gruppi con sottopagine, stati sempre con icona + parola, fonte dei dati su ogni pagina, tema chiaro/scuro/auto, schema della rete con versione verticale per il telefono). `costruisci()` in `app.js` unisce file di stato e controlli; le scadenze dei certificati si aggiungono da sole.

## Il file di stato (lo scrive Claude)

Sul server: `/DATA/AppData/claude-code/workspace/sicurezza-stato/stato.json` = nel container di Claude `/workspace/sicurezza-stato/stato.json`; nell'app `/stato/stato.json` (sola lettura). **Fuori da git** (descrive i punti deboli reali). Formato: vedi `esempio/stato.json` (dati inventati). Campi: `aggiornatoDaClaude` (ISO), `daFare`, `controlli` {`indirizzi` [nome, app, chiuso = pagina che senza login deve dare 401/403, livello?, nota?], `vps` {indirizzo, aperte, chiuse}}, `rete`, `casa`, `accessi` {chiave, altri}, `rischi`, `backup`, `versioni`, `scadenze` (con `data` AAAA-MM-GG), `macchina`, `diario`, `domande`. Stati: `ok`, `attenzione`, `critico`, `info`.

**Alla fine di ogni lavoro che tocca la sicurezza, aggiorna il file di stato** (e `aggiornatoDaClaude`): rischi risolti o nuovi, risposte di Fabio (account, domande), diario. Controlla che resti JSON valido (`python3 -m json.tool`). Non mettere indirizzi che non parlano HTTPS (posta, ripetitore) in `controlli.indirizzi`: darebbero falsi allarmi.

## Come provare

```bash
cd app && npm ci && cd ..
node --test prove/server.test.js        # 8 prove: proprietario, CSRF, controllo con finto sito HTTPS, posta esclusa
```

Prova a mano con i dati veri: avvia `app/server.js` con `PORT`, `DATA_DIR` (cartella temporanea), `STATO_FILE=/workspace/sicurezza-stato/stato.json`, `TS_PROPRIETARIO`, `CONTROLLO_ORA=99`, `PRIMO_CONTROLLO_MS=999999999`, e davanti un piccolo intermediario che aggiunge `Tailscale-User-Login` (come fa `tailscale serve`); foto delle schermate con Chromium headless. Mai scorciatoie di sviluppo nel codice dell'app.

## Come si pubblica

Come VideoRiunioni: numero nel file `VERSIONE` (1.0, 1.1…), +0.1 per le modifiche normali, +1 per quelle grandi, da aumentare in ogni pull request. L'Action pubblica `ghcr.io/fabiotomassoni02/sicurezza-casa:X.Y` e `:latest` dopo il merge; Fabio mette il numero in ZimaOS.
