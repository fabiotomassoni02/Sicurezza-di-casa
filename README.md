# Sicurezza di casa

Una pagina che mostra a colpo d'occhio lo stato della sicurezza della rete e del sistema di casa: cosa si vede da internet, le porte della VPS, gli account, i rischi aperti, i backup, gli aggiornamenti, le scadenze e la salute della macchina.

- **Solo dal tailnet** e **solo dal tuo account Tailscale**: da internet non si apre (Funnel spento), e dal tailnet chi non è il proprietario vede «Pagina riservata».
- **Nessun segreto**: nella pagina non ci sono password, chiavi o token, solo lo stato delle cose.
- **Nessun potere sul sistema**: il sito legge e basta. Non vede Docker, non entra nella VPS, non cambia niente.

## 1. Da dove arrivano i dati

| Fonte | Cosa | Quando |
|---|---|---|
| **Controlli automatici** del sito | ogni indirizzo pubblico risponde? senza password i dati restano chiusi? quanto manca alla scadenza del certificato? le porte della VPS sono aperte o chiuse come previsto? | ogni mattina (ora in `CONTROLLO_ORA`) e quando premi **Controlla adesso** (al massimo una volta al minuto) |
| **File di stato** scritto da Claude | rischi, account, backup, versioni, scadenze, salute della macchina, diario, domande, e l'elenco di cosa controllare | alla fine di ogni lavoro |

Le porte della posta (25, 465, 587, 993…) **non vengono mai provate**: il server di posta bloccherebbe l'indirizzo di casa.

## 2. Installazione su ZimaOS

1. **Tailscale** (console di Tailscale → *Access controls*): in `tagOwners` aggiungi `"tag:sicurezza": ["autogroup:admin"]` e salva. Non servono altre regole: i tuoi dispositivi arrivano già a tutto.
2. **Chiave** (console di Tailscale → *Settings → Keys → Generate auth key*): *Reusable* spento, *Ephemeral* spento, *Tags* `tag:sicurezza`. Copiala.
3. **Il file di stato**: la cartella `/DATA/AppData/claude-code/workspace/sicurezza-stato` con dentro `stato.json` la prepara Claude.
4. **ZimaOS** → App Store → **+** → *Importa* → incolla `docker-compose.zimaos.yml` con la chiave in `TS_AUTHKEY` e il tuo account in `TS_PROPRIETARIO`.
5. Dopo un minuto apri `https://sicurezza.<tailnet>.ts.net` da un tuo dispositivo con Tailscale acceso. Nei log dell'app: `raggiungibile dai dispositivi del tailnet`.
6. Dopo il primo avvio puoi cancellare `TS_AUTHKEY` dalle impostazioni dell'app: lo stato di Tailscale resta in `/DATA/AppData/sicurezza-casa/data/tailscale`.

## 3. Aggiornare

Ogni nuova versione ha un numero (1.0, 1.1…): nelle impostazioni dell'app in ZimaOS cambia il numero dopo `sicurezza-casa:` e salva.

## 4. Se qualcosa non va

| Problema | Cosa fare |
|---|---|
| «Pagina riservata» dal tuo dispositivo | Controlla che Tailscale sia acceso e che `TS_PROPRIETARIO` sia esattamente il tuo account (console di Tailscale → *Users*). |
| In cima alla pagina: «Il file di stato di Claude è mancante» | Chiedi a Claude di riscriverlo: la cartella è `/DATA/AppData/claude-code/workspace/sicurezza-stato`. |
| «Controllo non riuscito» | Il messaggio dice il motivo. Il controllo successivo riparte da solo la mattina dopo. |
