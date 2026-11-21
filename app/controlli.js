'use strict';
// I controlli automatici del sito. Leggono e basta: nessun login, nessuna modifica, nessun accesso
// alla ZimaBlade o alla VPS. Guardano il sistema come lo vede chiunque da internet.
//
// La configurazione (quali indirizzi, quali porte) arriva dal file di stato scritto da Claude,
// sezione "controlli":
//   { "indirizzi": [ { "nome": "file.esempio.it", "app": "Scambio file", "chiuso": "/api/links" } ],
//     "vps": { "indirizzo": "203.0.113.10", "aperte": [ { "porta": 443, "cosa": "pagine web" } ],
//              "chiuse": [ { "porta": 22, "cosa": "accesso al server" } ] } }
// "chiuso" = una pagina che senza login deve rispondere 401 o 403 (i dati restano chiusi).

const tls = require('node:tls');
const net = require('node:net');

// Porte della posta: MAI provarle, nemmeno se finissero nella configurazione per sbaglio.
// Stalwart blocca per sempre chi apre troppe connessioni a vuoto, e da qui partirebbero dall'indirizzo di casa.
const PORTE_MAI = new Set([25, 110, 143, 465, 587, 993, 995, 4190]);

const PASSI = ['Indirizzi pubblici: rispondono?', 'Dati chiusi senza password', 'Certificati e scadenze', 'Porte della VPS'];

const NOME_VALIDO = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IP_VALIDO = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function motivo(e) {
  const c = (e && e.cause && e.cause.code) || (e && e.code) || (e && e.name) || '';
  return ({
    ENOTFOUND: 'nome non trovato', EAI_AGAIN: 'nome non trovato', ECONNREFUSED: 'connessione rifiutata',
    ECONNRESET: 'connessione interrotta', ETIMEDOUT: 'nessuna risposta', AbortError: 'nessuna risposta (tempo scaduto)',
    TimeoutError: 'nessuna risposta (tempo scaduto)', CERT_HAS_EXPIRED: 'certificato scaduto',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'certificato non riconosciuto', SELF_SIGNED_CERT_IN_CHAIN: 'certificato non riconosciuto',
    ERR_TLS_CERT_ALTNAME_INVALID: 'certificato di un altro nome', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'certificato non riconosciuto',
  })[c] || String(c || (e && e.message) || 'errore');
}

// Configurazione controllata: nomi, percorsi e porte devono avere una forma sensata.
function convalida(config) {
  const c = config && typeof config === 'object' ? config : {};
  const indirizzi = (Array.isArray(c.indirizzi) ? c.indirizzi : [])
    .filter(i => i && (NOME_VALIDO.test(String(i.nome || '')) || i.nome === 'localhost'))
    .slice(0, 30).map(i => ({
      nome: String(i.nome).toLowerCase(),
      app: String(i.app || i.nome).slice(0, 60),
      porta: Number.isInteger(i.porta) && i.porta > 0 && i.porta < 65536 ? i.porta : 443,
      chiuso: typeof i.chiuso === 'string' && /^\/[\w\-./?=&%]*$/.test(i.chiuso) ? i.chiuso : null,
    }));
  const v = c.vps && typeof c.vps === 'object' ? c.vps : {};
  const ip = IP_VALIDO.exec(String(v.indirizzo || ''));
  const indirizzoVps = ip && ip.slice(1).every(n => +n <= 255) ? v.indirizzo
    : (NOME_VALIDO.test(String(v.indirizzo || '')) || v.indirizzo === 'localhost' ? v.indirizzo : null);
  const porte = (lista, attesa) => (Array.isArray(lista) ? lista : []).slice(0, 40)
    .filter(p => p && Number.isInteger(+p.porta) && +p.porta > 0 && +p.porta < 65536)
    .map(p => ({ porta: +p.porta, cosa: String(p.cosa || '').slice(0, 60), attesa }));
  return { indirizzi, vps: { indirizzo: indirizzoVps, porte: [...porte(v.aperte, 'aperta'), ...porte(v.chiuse, 'chiusa')] } };
}

async function richiesta(url, ms) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'sicurezza-casa (controllo in sola lettura)' } });
    await r.arrayBuffer().catch(() => {});
    return { codice: r.status };
  } catch (e) {
    return { errore: motivo(e) };
  }
}

function certificato(host, porta, ms) {
  return new Promise(fatto => {
    let finito = false;
    const fine = v => { if (!finito) { finito = true; fatto(v); } };
    const s = tls.connect({ host, port: porta, servername: host === 'localhost' ? undefined : host, rejectUnauthorized: false, timeout: ms }, () => {
      const c = s.getPeerCertificate();
      const valido = s.authorized;
      const errore = valido ? null : motivo({ code: s.authorizationError && (s.authorizationError.code || s.authorizationError) });
      s.end();
      if (!c || !c.valid_to) return fine({ valido: false, errore: 'nessun certificato' });
      const scade = new Date(c.valid_to);
      fine({ valido, errore, scade: scade.toISOString(), giorni: Math.floor((scade - Date.now()) / 864e5) });
    });
    s.on('timeout', () => { s.destroy(); fine({ valido: false, errore: 'nessuna risposta' }); });
    s.on('error', e => fine({ valido: false, errore: motivo(e) }));
  });
}

function porta(host, numero, ms) {
  return new Promise(fatto => {
    const s = net.connect({ host, port: numero });
    const t = setTimeout(() => { s.destroy(); fatto('chiusa'); }, ms); // filtrata dal firewall = chiusa
    s.on('connect', () => { clearTimeout(t); s.destroy(); fatto('aperta'); });
    s.on('error', () => { clearTimeout(t); fatto('chiusa'); });
  });
}

// Esegue i quattro passi; avanzamento(n) dice quanti passi sono finiti.
async function eseguiControlli(config, avanzamento = () => {}, tempi = {}) {
  const { indirizzi, vps } = convalida(config);
  const msWeb = tempi.web || 10000, msPorta = tempi.porta || 4000;
  const base = i => `https://${i.nome}${i.porta === 443 ? '' : ':' + i.porta}`;
  const ris = indirizzi.map(i => ({ nome: i.nome, app: i.app }));

  avanzamento(0);
  await Promise.all(indirizzi.map(async (i, k) => {
    const x = await richiesta(base(i) + '/', msWeb);
    ris[k].risponde = !!x.codice && x.codice < 500;
    ris[k].codice = x.codice || null;
    if (x.errore) ris[k].errore = x.errore;
  }));
  avanzamento(1);
  await Promise.all(indirizzi.map(async (i, k) => {
    if (!i.chiuso) { ris[k].chiuso = null; return; }
    const x = await richiesta(base(i) + i.chiuso, msWeb);
    ris[k].chiuso = x.codice === 401 || x.codice === 403 ? true : x.codice ? false : null;
    ris[k].codiceChiuso = x.codice || null;
  }));
  avanzamento(2);
  await Promise.all(indirizzi.map(async (i, k) => { ris[k].cert = await certificato(i.nome, i.porta, msWeb); }));
  avanzamento(3);
  const porte = await Promise.all(vps.porte.map(async p => {
    if (PORTE_MAI.has(p.porta)) return { ...p, trovata: null, nota: 'porta della posta: non provata apposta' };
    if (!vps.indirizzo) return { ...p, trovata: null, nota: 'indirizzo della VPS mancante' };
    return { ...p, trovata: await porta(vps.indirizzo, p.porta, msPorta) };
  }));
  avanzamento(4);
  return { indirizzi: ris, porte };
}

// Problemi trovati, come frasi brevi (servono anche a dire cosa è cambiato rispetto al controllo prima).
function problemiDi(r) {
  const out = [];
  for (const i of r.indirizzi || []) {
    if (!i.risponde) out.push(`${i.nome} non risponde${i.errore ? ' (' + i.errore + ')' : ''}`);
    if (i.chiuso === false) out.push(`${i.nome}: dati visibili senza password`);
    const c = i.cert || {};
    if (i.risponde && (c.valido === false || c.errore)) out.push(`${i.nome}: certificato non valido (${c.errore || 'motivo sconosciuto'})`);
    else if (typeof c.giorni === 'number' && c.giorni < 25) out.push(`${i.nome}: certificato in scadenza (${c.giorni} giorni) e non ancora rinnovato`);
  }
  for (const p of r.porte || []) if (p.trovata && p.trovata !== p.attesa) out.push(`porta ${p.porta} della VPS ${p.trovata} (doveva essere ${p.attesa})`);
  return out;
}

function testoEsito(problemi, nuovi, risolti) {
  const parti = [];
  if (nuovi.length) parti.push('Novità: ' + nuovi.join('; ') + '.');
  if (risolti.length) parti.push('Tornato a posto: ' + risolti.join('; ') + '.');
  if (!problemi.length && !nuovi.length) parti.push('Tutto come deve essere.');
  else if (!nuovi.length) parti.push(`Niente di nuovo: ${problemi.length} ${problemi.length === 1 ? 'cosa' : 'cose'} da guardare, già note.`);
  return parti.join(' ');
}

module.exports = { PASSI, PORTE_MAI, convalida, eseguiControlli, problemiDi, testoEsito };
