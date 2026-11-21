# Stato del lavoro

Aggiornato al 21 novembre 2026. Da leggere all'inizio di ogni sessione e da aggiornare alla fine. Le note tecniche stabili stanno in `CLAUDE.md`.

## Com'è nata

Il 21/11/2026, dopo il resoconto di sicurezza (`/workspace/sicurezza-sistema-2026-11-21.md`), Fabio ha chiesto «un piccolo sito che gira in locale a cui posso accedere solo dal tailnet in cui posso vedere a colpo d'occhio lo stato della sicurezza della mia rete e del mio sistema», aggiornato da Claude man mano. Tre bozze (in `/workspace/sicurezza-bozza/`): la prima su una pagina sola; la seconda con menu a gruppi e sottopagine («grafica e gerarchie dei contenuti non ottimali… menu con sottopagine»); la terza con il pulsante «Controlla adesso». Approvata: «per il resto va bene».

## Versione 1.0 (ramo `prima-versione`)

- App completa: server, controlli automatici, pagina dalla bozza approvata, pagina riservata, prove (8, tutte verdi), workflow, file per ZimaOS, documentazione.
- Provata il 21/11 in locale con il file di stato vero e un **controllo vero**: 5 indirizzi rispondono e tengono chiusi i dati (403/401), certificati validi (36–88 giorni), VPS con solo 80/443/3478 aperte e 7 porte interne chiuse: «Tutto come deve essere». Schermate controllate (computer, telefono, scuro).
- File di stato vero: `/workspace/sicurezza-stato/stato.json` (fuori da git).

## In produzione

- **1.0** (PR #2, unita il 21/11) installata da Fabio in ZimaOS, solo nel tailnet (`tag:sicurezza`). Verificato sull'app vera: da internet il nome non si trova (Funnel spento), pulsante protetto, controllo dell'app installata «Tutto come deve essere», schermate giuste.
- Un limite che non dipende dall'app è annotato nel file di stato (sezione rischi) e nelle note locali di Claude: non riportarlo qui.

## 1.1 (ramo `note-di-claude`)

- Fabio (21/11) ha chiesto perché Immich era «Da guardare» con il controllo tutto a posto: era il `livello` messo da Claude nel file di stato. Sua scelta: **separare le note di Claude**. Ora lo stato di un indirizzo viene solo dal controllo automatico, e la nota compare a parte con la matita («Nota di Claude: …»). Il giallo su Immich è stato tolto subito dal file di stato.
- Corrette le etichette dei rischi sul telefono (si allungavano in ovali alti; ora stanno sotto il titolo).

## Da fare

- [x] Fabio ha creato il repository privato `fabiotomassoni02/sicurezza-di-casa` e l'ha aggiunto al token fine-grained (21/11; il token scade il 26/12/2026).
- [ ] Push del ramo e pull request (Fabio la unisce) → immagine `:1.0`; Fabio rende pubblico il pacchetto su ghcr (come per le altre app).
- [ ] Tailscale: `tag:sicurezza` in `tagOwners`, chiave monouso con quel tag.
- [ ] Import in ZimaOS (compose con `TS_PROPRIETARIO` vero), prova dal Mac e dal telefono.
- [ ] Regola fissa per tutte le sessioni: aggiornare il file di stato alla fine di ogni lavoro che tocca la sicurezza (memoria + agente coordinatore).

## Idee per dopo

- Avviso (notifica o email) quando il controllo del mattino trova una novità.
- Storico dei controlli in un piccolo grafico (i dati ci sono già in `controlli.json`).
