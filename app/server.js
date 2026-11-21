'use strict';
// Sicurezza di casa: una pagina, visibile solo dal tailnet e solo dal proprietario, che mostra a colpo
// d'occhio lo stato della sicurezza della rete e del sistema.
//
// Due fonti di dati:
//  - il file di stato scritto da Claude (STATO_FILE, montato in sola lettura): rischi, accessi, backup,
//    versioni, scadenze, salute della macchina, diario, domande, e la configurazione dei controlli;
//  - i controlli automatici fatti dal sito stesso (controlli.js), ogni mattina o con il pulsante.
// Il sito legge e basta: nessun accesso a Docker, alla ZimaBlade o alla VPS, nessun segreto.

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { PASSI, eseguiControlli, problemiDi, testoEsito } = require('./controlli');

const PORT = Number(process.env.PORT) || 3000;
// Di norma l'app ascolta solo dentro il container: la raggiunge soltanto Tailscale (tailscale serve).
const HOST = process.env.ASCOLTO || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR || '/data';
const STATO_FILE = process.env.STATO_FILE || '/stato/stato.json';
const FILE_CONTROLLI = path.join(DATA_DIR, 'controlli.json');
const ORA_CONTROLLO = Number.isInteger(+process.env.CONTROLLO_ORA) ? +process.env.CONTROLLO_ORA : 6;
const ATTESA_MINIMA_MS = Number(process.env.ATTESA_CONTROLLI_MS) || 60_000;
const APP_VERSION = process.env.APP_VERSION || 'sviluppo';
const APP_BUILT = process.env.APP_BUILT || '';
// Account Tailscale del proprietario: solo lui, entrando dal tailnet, vede la pagina.
const OWNERS = (process.env.TS_PROPRIETARIO || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const log = (...a) => console.log(new Date().toISOString(), ...a);

function leggiJson(file) {
  try { return { dati: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { return { errore: e.code === 'ENOENT' ? 'mancante' : 'non valido: ' + e.message.slice(0, 120) }; }
}
function scriviJson(file, dati) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dati, null, 1));
  fs.renameSync(tmp, file);
}

// ---------- controlli ----------
let controllo = { inCorso: false, passo: 0, iniziato: null, fine: null };
let ultimoAvvio = 0;
const statoControllo = () => ({ inCorso: controllo.inCorso, passo: controllo.passo, passi: PASSI, iniziato: controllo.iniziato, fine: controllo.fine });

async function avviaControllo(motivo) {
  if (controllo.inCorso) return;
  ultimoAvvio = Date.now();
  controllo = { inCorso: true, passo: 0, iniziato: new Date().toISOString(), fine: null };
  try {
    const stato = leggiJson(STATO_FILE);
    if (!stato.dati || !stato.dati.controlli) throw new Error('nel file di stato manca la configurazione dei controlli');
    const ris = await eseguiControlli(stato.dati.controlli, p => { controllo.passo = p; });
    const prima = leggiJson(FILE_CONTROLLI).dati || {};
    const problemi = problemiDi(ris), vecchi = Array.isArray(prima.problemi) ? prima.problemi : [];
    const nuovi = problemi.filter(p => !vecchi.includes(p)), risolti = vecchi.filter(p => !problemi.includes(p));
    const quando = new Date().toISOString();
    const storico = [...(Array.isArray(prima.storico) ? prima.storico : []), { quando, motivo, problemi: problemi.length }].slice(-90);
    scriviJson(FILE_CONTROLLI, { quando, motivo, ...ris, problemi, nuovi, risolti, storico });
    controllo.fine = { quando, esito: testoEsito(problemi, nuovi, risolti), problemi: problemi.length, nuovi: nuovi.length, errore: false };
    log(`[controllo] ${motivo}: ${problemi.length} cose da guardare, ${nuovi.length} nuove, ${risolti.length} tornate a posto`);
  } catch (e) {
    controllo.fine = { quando: new Date().toISOString(), esito: 'Il controllo non è riuscito: ' + e.message, errore: true };
    log('[controllo] non riuscito:', e.message);
  } finally {
    controllo.inCorso = false;
  }
}

// ---------- server ----------
const app = express();
app.disable('x-powered-by');
app.set('etag', false);
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cache-Control': 'no-store',
    'Strict-Transport-Security': 'max-age=31536000',
  });
  next();
});

function isLoopback(a) { return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; }
// Il proprietario: richiesta arrivata da Tailscale sullo stesso container (127.0.0.1), non da Funnel,
// con l'intestazione Tailscale-User-Login di uno degli account in TS_PROPRIETARIO.
// Tailscale toglie queste intestazioni quando arrivano dal browser, quindi non si possono falsificare.
function ownerOf(req) {
  if (!OWNERS.length || !isLoopback(req.socket.remoteAddress)) return null;
  if (req.get('Tailscale-Funnel-Request')) return null;
  const login = String(req.get('Tailscale-User-Login') || '').trim().toLowerCase();
  if (!login || !OWNERS.includes(login)) return null;
  return { login, name: String(req.get('Tailscale-User-Name') || login) };
}
const soloProprietario = (req, res, next) => (ownerOf(req) ? next() : res.status(403).json({ error: 'Pagina riservata al proprietario.' }));
// Protezione CSRF: le richieste che cambiano qualcosa vogliono l'intestazione X-SC (un altro sito non
// può aggiungerla) e, se il browser la manda, un'origine uguale alla nostra.
function csrf(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('Origin');
  let stessa = !origin;
  try { if (origin) stessa = new URL(origin).host === req.get('Host'); } catch { stessa = false; }
  if (req.get('X-SC') !== '1' || !stessa) return res.status(403).json({ error: 'Richiesta non valida.' });
  next();
}

app.use('/api', csrf);
app.get('/api/salute', (req, res) => res.json({ ok: true }));

app.get('/api/stato', soloProprietario, (req, res) => {
  const stato = leggiJson(STATO_FILE);
  const auto = leggiJson(FILE_CONTROLLI);
  res.json({
    versione: APP_VERSION, costruita: APP_BUILT, proprietario: ownerOf(req).name,
    claude: stato.dati || null, erroreStato: stato.errore || null,
    auto: auto.dati || null, controllo: statoControllo(), oraControllo: ORA_CONTROLLO,
  });
});
app.get('/api/controllo', soloProprietario, (req, res) => res.json(statoControllo()));
app.post('/api/controlla', soloProprietario, (req, res) => {
  if (controllo.inCorso) return res.status(409).json({ error: 'Un controllo è già in corso.', ...statoControllo() });
  const attesa = ATTESA_MINIMA_MS - (Date.now() - ultimoAvvio);
  if (attesa > 0) return res.status(429).json({ error: `Aspetta ancora ${Math.ceil(attesa / 1000)} secondi: al massimo un controllo al minuto.` });
  avviaControllo('pulsante');
  res.status(202).json(statoControllo());
});
app.use('/api', (req, res) => res.status(404).json({ error: 'Non trovato.' }));

const PUBBLICA = path.join(__dirname, 'public');
app.use('/risorse', express.static(path.join(PUBBLICA, 'risorse'), { index: false, fallthrough: false }));
// percorsi fissi scelti dal codice: "dotfiles: allow" serve solo se l'app sta in una cartella con un punto nel nome
app.get('/', (req, res) => {
  if (ownerOf(req)) return res.sendFile(path.join(PUBBLICA, 'index.html'), { dotfiles: 'allow' });
  res.status(403).sendFile(path.join(PUBBLICA, 'riservata.html'), { dotfiles: 'allow' });
});
app.use((req, res) => res.status(404).type('text/plain').send('Pagina non trovata.'));

// ---------- avvio ----------
// Ogni giorno all'ora CONTROLLO_ORA (ora italiana), una volta sola; e all'avvio se l'ultimo è vecchio.
function giaFattoOggi() {
  const q = (leggiJson(FILE_CONTROLLI).dati || {}).quando;
  const soglia = new Date(); soglia.setHours(ORA_CONTROLLO, 0, 0, 0);
  return !!q && new Date(q) >= soglia; // un controllo con il pulsante prima di quell'ora non lo fa saltare
}
setInterval(() => {
  if (new Date().getHours() === ORA_CONTROLLO && !giaFattoOggi()) avviaControllo('ogni mattina');
}, 60_000).unref();
setTimeout(() => {
  const q = (leggiJson(FILE_CONTROLLI).dati || {}).quando;
  if (!q || Date.now() - new Date(q) > 26 * 36e5) avviaControllo('avvio');
}, Number(process.env.PRIMO_CONTROLLO_MS) || 20_000).unref();

app.listen(PORT, HOST, () => {
  log(`Sicurezza di casa, versione ${APP_VERSION}, costruita ${APP_BUILT || '-'}, in ascolto su ${HOST}:${PORT}`);
  if (!OWNERS.length) log('Attenzione: TS_PROPRIETARIO è vuota, nessuno può vedere la pagina.');
  else log('Pagina riservata a: ' + OWNERS.join(', '));
  const s = leggiJson(STATO_FILE);
  log(s.dati ? `File di stato: ${STATO_FILE} (aggiornato da Claude ${s.dati.aggiornatoDaClaude || '?'})` : `File di stato ${STATO_FILE} ${s.errore}`);
});
