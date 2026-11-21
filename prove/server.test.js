'use strict';
// Prove del server: node --test prove/server.test.js (dentro l'immagine: /prove/server.test.js).
// Tutto in locale: un finto sito HTTPS con certificato di prova, porte su 127.0.0.1, nessun accesso a internet.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const net = require('node:net');
const { spawn } = require('node:child_process');

const APP = process.env.APP_DIR || (fs.existsSync('/app/server.js') ? '/app' : path.join(__dirname, '..', 'app'));
const { convalida, problemiDi, testoEsito, PORTE_MAI } = require(path.join(APP, 'controlli.js'));
const CERT = path.join(__dirname, 'certificato-prova');
const PROPRIETARIO = 'prova@example.com';

const portaLibera = () => new Promise(ok => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const pausa = ms => new Promise(r => setTimeout(r, ms));

let server, sito, PORTA, PORTA_SITO, PORTA_CHIUSA, cartella, fileStato, BASE;
const IO = { 'Tailscale-User-Login': PROPRIETARIO, 'Tailscale-User-Name': 'Prova' };

function statoDiProva() {
  return {
    aggiornatoDaClaude: '2026-11-21T10:30:00Z',
    rischi: [{ id: 'x', titolo: 'Rischio di prova', livello: 'attenzione', stato: 'aperto', perche: 'p', oggi: 'o', prossimo: 'n', entro: 'presto' }],
    controlli: {
      indirizzi: [
        { nome: 'localhost', app: 'Sito chiuso', porta: PORTA_SITO, chiuso: '/privato' },
        { nome: 'localhost', app: 'Sito aperto per sbaglio', porta: PORTA_SITO, chiuso: '/aperto' },
      ],
      vps: { indirizzo: 'localhost', aperte: [{ porta: PORTA_SITO, cosa: 'sito' }], chiuse: [{ porta: PORTA_CHIUSA, cosa: 'chiusa' }, { porta: 25, cosa: 'posta' }] },
    },
  };
}

test.before(async () => {
  [PORTA, PORTA_SITO, PORTA_CHIUSA] = [await portaLibera(), await portaLibera(), await portaLibera()];
  sito = https.createServer({ key: fs.readFileSync(path.join(CERT, 'chiave.pem')), cert: fs.readFileSync(path.join(CERT, 'certificato.pem')) }, (req, res) => {
    res.statusCode = req.url === '/privato' ? 401 : 200;
    res.end('ok');
  });
  await new Promise(ok => sito.listen(PORTA_SITO, '127.0.0.1', ok));
  cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'sicurezza-prova-'));
  fileStato = path.join(cartella, 'stato.json');
  fs.writeFileSync(fileStato, JSON.stringify(statoDiProva()));
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(APP, 'server.js')], {
    env: { ...process.env, PORT: String(PORTA), ASCOLTO: '127.0.0.1', DATA_DIR: path.join(cartella, 'dati'), STATO_FILE: fileStato,
      TS_PROPRIETARIO: PROPRIETARIO, NODE_EXTRA_CA_CERTS: path.join(CERT, 'certificato.pem'),
      CONTROLLO_ORA: '99', PRIMO_CONTROLLO_MS: '999999999', ATTESA_CONTROLLI_MS: '60000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let uscita = '';
  server.stdout.on('data', d => { uscita += d; });
  server.stderr.on('data', d => { uscita += d; });
  BASE = `http://127.0.0.1:${PORTA}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/salute')).ok) return; } catch {}
    await pausa(100);
  }
  throw new Error('Il server non parte:\n' + uscita);
});
test.after(() => { if (server) server.kill(); if (sito) sito.close(); fs.rmSync(cartella, { recursive: true, force: true }); });

test('la salute risponde a tutti', async () => {
  const r = await fetch(BASE + '/api/salute');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

test('pagina e dati sono riservati al proprietario', async () => {
  const pagina = await fetch(BASE + '/');
  assert.equal(pagina.status, 403);
  assert.match(await pagina.text(), /Pagina riservata/);
  assert.equal((await fetch(BASE + '/', { headers: { 'Tailscale-User-Login': 'altro@example.com' } })).status, 403);
  // da Funnel (internet) mai, nemmeno con il login giusto
  assert.equal((await fetch(BASE + '/', { headers: { ...IO, 'Tailscale-Funnel-Request': '?1' } })).status, 403);
  assert.equal((await fetch(BASE + '/api/stato')).status, 403);
  assert.equal((await fetch(BASE + '/api/controllo')).status, 403);
  const mia = await fetch(BASE + '/', { headers: IO });
  assert.equal(mia.status, 200);
  assert.match(await mia.text(), /Sicurezza di casa/);
  const stato = await (await fetch(BASE + '/api/stato', { headers: IO })).json();
  assert.equal(stato.claude.rischi[0].titolo, 'Rischio di prova');
  assert.equal(stato.erroreStato, null);
  assert.equal(stato.controllo.passi.length, 4);
});

test('il pulsante non si può premere da un altro sito', async () => {
  assert.equal((await fetch(BASE + '/api/controlla', { method: 'POST', headers: IO })).status, 403);
  assert.equal((await fetch(BASE + '/api/controlla', { method: 'POST', headers: { ...IO, 'X-SC': '1', Origin: 'https://cattivo.example' } })).status, 403);
  assert.equal((await fetch(BASE + '/api/controlla', { method: 'POST', headers: { 'X-SC': '1' } })).status, 403);
});

test('il controllo vede sito, dati chiusi o aperti, certificato e porte, e non tocca la posta', async () => {
  const via = await fetch(BASE + '/api/controlla', { method: 'POST', headers: { ...IO, 'X-SC': '1' } });
  assert.equal(via.status, 202);
  let s;
  for (let i = 0; i < 150; i++) {
    s = await (await fetch(BASE + '/api/controllo', { headers: IO })).json();
    if (!s.inCorso && s.fine) break;
    await pausa(100);
  }
  assert.equal(s.inCorso, false);
  assert.equal(s.fine.errore, false, s.fine.esito);
  const auto = (await (await fetch(BASE + '/api/stato', { headers: IO })).json()).auto;
  const [chiuso, aperto] = auto.indirizzi;
  assert.equal(chiuso.risponde, true);
  assert.equal(chiuso.chiuso, true);
  assert.equal(chiuso.cert.valido, true, JSON.stringify(chiuso.cert));
  assert.ok(chiuso.cert.giorni > 3000);
  assert.equal(aperto.chiuso, false);
  assert.ok(auto.problemi.some(p => p.includes('dati visibili senza password')));
  const porta = n => auto.porte.find(p => p.porta === n);
  assert.equal(porta(PORTA_SITO).trovata, 'aperta');
  assert.equal(porta(PORTA_CHIUSA).trovata, 'chiusa');
  assert.equal(porta(25).trovata, null);
  assert.match(porta(25).nota, /posta/);
  assert.match(s.fine.esito, /Novità/);
  // al massimo un controllo al minuto
  const subito = await fetch(BASE + '/api/controlla', { method: 'POST', headers: { ...IO, 'X-SC': '1' } });
  assert.equal(subito.status, 429);
});

test('le risorse si servono, il resto no', async () => {
  assert.equal((await fetch(BASE + '/risorse/app.js')).status, 200);
  assert.equal((await fetch(BASE + '/risorse/stile.css')).status, 200);
  assert.equal((await fetch(BASE + '/index.html', { headers: IO })).status, 404);
  assert.equal((await fetch(BASE + '/server.js', { headers: IO })).status, 404);
  assert.notEqual((await fetch(BASE + '/risorse/%2e%2e/server.js')).status, 200);
});

test('un file di stato rovinato non blocca la pagina', async () => {
  fs.writeFileSync(fileStato, '{ rotto');
  const r = await (await fetch(BASE + '/api/stato', { headers: IO })).json();
  assert.equal(r.claude, null);
  assert.match(r.erroreStato, /non valido/);
  fs.writeFileSync(fileStato, JSON.stringify(statoDiProva()));
});

test('configurazione: nomi e porte strani vengono scartati, la posta è sempre esclusa', () => {
  const c = convalida({
    indirizzi: [{ nome: 'buono.esempio.it', chiuso: '/api/x' }, { nome: 'http://cattivo' }, { nome: 'x.esempio.it', chiuso: 'javascript:1' }],
    vps: { indirizzo: '999.1.1.1', aperte: [{ porta: 443 }], chiuse: [{ porta: 70000 }, { porta: 'abc' }] },
  });
  assert.deepEqual(c.indirizzi.map(i => i.nome), ['buono.esempio.it', 'x.esempio.it']);
  assert.equal(c.indirizzi[1].chiuso, null);
  assert.equal(c.vps.indirizzo, null);
  assert.deepEqual(c.vps.porte.map(p => p.porta), [443]);
  for (const p of [25, 465, 993, 587, 143, 110]) assert.ok(PORTE_MAI.has(p));
});

test('esito in italiano semplice', () => {
  const r = { indirizzi: [{ nome: 'a.it', risponde: true, chiuso: true, cert: { valido: true, giorni: 12 } }], porte: [{ porta: 22, attesa: 'chiusa', trovata: 'aperta' }] };
  const p = problemiDi(r);
  assert.equal(p.length, 2);
  assert.match(testoEsito(p, p, []), /^Novità: /);
  assert.match(testoEsito(p, [], []), /Niente di nuovo: 2 cose/);
  assert.equal(testoEsito([], [], []), 'Tutto come deve essere.');
  assert.match(testoEsito([], [], ['x']), /Tornato a posto: x/);
});
