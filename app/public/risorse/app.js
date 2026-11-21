/* ===================== DATI =====================
   Arrivano da /api/stato: "claude" = il file di stato che Claude aggiorna alla fine di ogni lavoro,
   "auto" = i risultati dei controlli che il sito fa da solo (ogni mattina o con il pulsante).
   Stati: ok · attenzione · critico · info                                                     */
let DATI = null, INFO = { versione: "", passi: [] };
const adesso = () => new Date();
const RETE_VUOTA = { titolo: "", stato: "info", righe: ["Claude non ha ancora descritto questa parte."] };
function giorniA(data) { return Math.ceil((new Date(data + "T12:00:00") - adesso()) / 864e5); }
function costruisci(r) {
  const c = r.claude || {}, a = r.auto;
  const cfg = c.controlli || {};
  const risultati = new Map(((a && a.indirizzi) || []).map(x => [x.nome, x]));
  const internet = (cfg.indirizzi || []).map(i => {
    const x = risultati.get(String(i.nome).toLowerCase()), note = [];
    const g = x && x.cert && typeof x.cert.giorni === "number" ? x.cert.giorni : null;
    let s = "info";
    if (!x) note.push("non ancora controllato");
    else {
      s = "ok";
      if (!x.risponde) { s = "critico"; note.push("non risponde" + (x.errore ? " (" + x.errore + ")" : "")); }
      if (x.chiuso === false) { s = "critico"; note.push("dati visibili senza password!"); }
      if (x.risponde && x.cert && (x.cert.valido === false || x.cert.errore)) { s = "critico"; note.push("certificato non valido"); }
      else if (g !== null && g < 10) { s = "critico"; note.push("certificato quasi scaduto"); }
      else if (g !== null && g < 25) { s = peggiore([s, "attenzione"]); note.push("il certificato doveva già rinnovarsi"); }
    }
    // lo stato viene SOLO dal controllo automatico; le note di Claude si mostrano a parte (con la matita)
    return { nome: i.nome, app: i.app || i.nome, risponde: x ? x.risponde : null, chiuso: x ? x.chiuso : null, certGiorni: g, stato: s,
             nota: note.join(" · "), notaClaude: i.nota ? String(i.nota) : "" };
  });
  const vps = cfg.vps || {};
  const porteVps = a && a.porte ? a.porte.map(p => ({ porta: String(p.porta), cosa: p.cosa, attesa: p.attesa, trovata: p.trovata, nota: p.nota }))
    : [...(vps.aperte || []).map(p => ({ porta: String(p.porta), cosa: p.cosa, attesa: "aperta", trovata: null, nota: "non ancora controllata" })),
       ...(vps.chiuse || []).map(p => ({ porta: String(p.porta), cosa: p.cosa, attesa: "chiusa", trovata: null, nota: "non ancora controllata" }))];
  // scadenze: quelle scritte da Claude + i certificati visti dai controlli (raggruppati se scadono lo stesso giorno)
  const certi = new Map();
  for (const i of internet) if (i.certGiorni !== null) { const k = i.certGiorni; certi.set(k, [...(certi.get(k) || []), i.app]); }
  const scadenze = [
    ...(c.scadenze || []).map(s => ({ giorni: s.data ? giorniA(s.data) : s.giorni, cosa: s.cosa, dettaglio: s.dettaglio || "", stato: s.stato || "info" })),
    ...[...certi].map(([g, app]) => ({ giorni: g, cosa: (app.length > 1 ? "Certificati di " : "Certificato di ") + app.join(" e "),
      dettaglio: g < 25 ? "doveva già rinnovarsi da solo: da controllare" : "si rinnova da solo", stato: g < 10 ? "critico" : g < 25 ? "attenzione" : "ok" }))
  ].filter(s => typeof s.giorni === "number");
  const rete = {};
  for (const k of ["internet", "vps", "zimablade", "dispositivi", "wifi"]) rete[k] = { ...RETE_VUOTA, titolo: k, ...((c.rete || {})[k] || {}) };
  return {
    controlloAuto: a ? a.quando : null, aggiornatoDaClaude: c.aggiornatoDaClaude || null,
    daFare: c.daFare || [], rete, internet, porteVps, casa: c.casa || [],
    accessi: { chiave: (c.accessi || {}).chiave || null, altri: (c.accessi || {}).altri || [] },
    rischi: c.rischi || [], backup: c.backup || [], versioni: c.versioni || [], scadenze,
    macchina: c.macchina || [], diario: c.diario || [], domande: c.domande || [], erroreStato: r.erroreStato
  };
}

/* ===================== AIUTI ===================== */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ic = (nome) => `<svg class="ic" aria-hidden="true"><use href="#i-${nome}"/></svg>`;
const PAROLA = { ok: "A posto", attenzione: "Da guardare", serio: "Serio", critico: "Critico", info: "Info" };
const ICONA = { ok: "ok", attenzione: "attenzione", serio: "attenzione", critico: "critico", info: "info" };
const stato = (s, testo) => `<span class="stato ${s}">${ic(ICONA[s])}${esc(testo ?? PAROLA[s])}</span>`;
const ordine = { critico: 3, serio: 2, attenzione: 1, info: 0, ok: 0 };
const peggiore = (lista) => lista.reduce((p, s) => (ordine[s] > ordine[p] ? s : p), "ok");
function quantoFa(iso) {
  if (!iso) return "mai";
  const ore = Math.round((adesso() - new Date(iso)) / 36e5);
  if (ore < 1) return "pochi minuti fa";
  if (ore < 24) return ore === 1 ? "1 ora fa" : ore + " ore fa";
  const g = Math.round(ore / 24); return g === 1 ? "ieri" : g + " giorni fa";
}
const fonte = (tipo) => tipo === "auto"
  ? `<span class="fonte">${ic("robot")}Controllo automatico · ${quantoFa(DATI.controlloAuto)}</span>`
  : `<span class="fonte">${ic("matita")}Aggiornato da Claude · ${quantoFa(DATI.aggiornatoDaClaude)}</span>`;

const statoPorta = p => p.trovata == null ? "info" : p.attesa === p.trovata ? "ok" : "critico";
/* stato riassuntivo di ogni area (usato da menu e panoramica) */
const rischiAperti = () => DATI.rischi.filter(r => r.stato !== "risolto");
const AREE = {
  esposizione: () => peggiore([...DATI.internet.map(i => i.stato), ...DATI.porteVps.map(statoPorta), ...DATI.casa.map(c => c.stato)]),
  rete: () => peggiore(Object.values(DATI.rete).map(n => n.stato)),
  accessi: () => { const k = DATI.accessi.chiave; return peggiore([...(k ? [k.stato, ...(k.controlli || []).map(c => c.stato)] : []), ...DATI.accessi.altri.map(a => a.stato)]); },
  backup: () => peggiore(DATI.backup.map(b => b.stato)),
  aggiornamenti: () => peggiore(DATI.versioni.map(v => v.stato)),
  rischi: () => peggiore(rischiAperti().map(r => r.livello)),
  scadenze: () => peggiore(DATI.scadenze.filter(s => s.giorni <= 30).map(s => s.stato)),
  macchina: () => peggiore(DATI.macchina.map(m => m.stato)),
  diario: () => "ok", domande: () => "ok", panoramica: () => "ok"
};

/* ===================== MENU ===================== */
const MENU = [
  { gruppo: null, voci: [ { id: "panoramica", nome: "Panoramica", icona: "panoramica" } ] },
  { gruppo: "Sorveglianza", voci: [ { id: "esposizione", nome: "Esposizione", icona: "mondo" }, { id: "rete", nome: "Com'è fatta la rete", icona: "rete" } ] },
  { gruppo: "Protezioni", voci: [ { id: "accessi", nome: "Accessi", icona: "chiave" }, { id: "backup", nome: "Backup", icona: "archivio" }, { id: "aggiornamenti", nome: "Aggiornamenti", icona: "aggiorna" } ] },
  { gruppo: "Problemi", voci: [ { id: "rischi", nome: "Rischi", icona: "allarme" }, { id: "scadenze", nome: "Scadenze", icona: "calendario" } ] },
  { gruppo: "Sistema", voci: [ { id: "macchina", nome: "Salute della macchina", icona: "chip" } ] },
  { gruppo: "Registro", voci: [ { id: "diario", nome: "Diario", icona: "libro" }, { id: "domande", nome: "Domande per te", icona: "domanda" } ] }
];
const VOCI = Object.fromEntries(MENU.flatMap(g => g.voci.map(v => [v.id, { ...v, gruppo: g.gruppo }])));

function segnoMenu(id) {
  if (id === "rischi") { const n = rischiAperti().length; const s = AREE.rischi(); return `<span class="conteggio ${s === "critico" ? "critico" : s === "attenzione" ? "attenzione" : ""}" aria-label="${n} rischi aperti">${n}</span>`; }
  if (id === "domande") { const n = DATI.domande.length; return n ? `<span class="conteggio" aria-label="${n} domande">${n}</span>` : ""; }
  if (id === "panoramica" || id === "diario") return "";
  const s = AREE[id](); return `<span class="puntino ${s}" title="${PAROLA[s]}" aria-label="${PAROLA[s]}"></span>`;
}
function disegnaMenu(attiva) {
  document.getElementById("voci").innerHTML = MENU.map(g =>
    (g.gruppo ? `<div class="gruppo">${esc(g.gruppo)}</div>` : "") +
    g.voci.map(v => `<a class="voce${v.id === attiva ? " attiva" : ""}" href="#/${v.id}"${v.id === attiva ? ' aria-current="page"' : ""}>${ic(v.icona)}<span class="nome">${esc(v.nome)}</span>${segnoMenu(v.id)}</a>`).join("")
  ).join("");
}

/* ===================== PAGINE ===================== */
const PAGINE = {};

PAGINE.panoramica = () => {
  const aperti = rischiAperti();
  const critici = aperti.filter(r => r.livello === "critico").length;
  const generale = peggiore(Object.keys(AREE).map(k => AREE[k]()));
  const tutte = [...DATI.internet.map(i => i.stato), ...DATI.backup.map(b => b.stato), ...DATI.versioni.map(v => v.stato),
                 ...DATI.macchina.map(m => m.stato), ...DATI.accessi.altri.map(a => a.stato), ...((DATI.accessi.chiave || {}).controlli || []).map(c => c.stato)]
                 .filter(s => s !== "info");
  const conta = (s) => tutte.filter(x => x === s).length;
  const seg = ["ok", "attenzione", "critico"].map(s => [s, conta(s)]).filter(([, n]) => n);
  const tot = tutte.length;
  const titolo = critici ? (critici === 1 ? "problema critico da risolvere" : "problemi critici da risolvere")
               : generale === "attenzione" ? "problemi critici · qualcosa da guardare" : "problemi · tutto a posto";
  const plurale = (s, n) => ({ ok: "a posto", attenzione: "da guardare", critico: n === 1 ? "critico" : "critici" }[s]);
  const tuttoChiuso = DATI.internet.every(i => i.chiuso !== false) && DATI.porteVps.every(p => statoPorta(p) !== "critico");
  const aree = [
    { id: "esposizione", nome: "Esposizione", valore: `${DATI.internet.filter(i => i.chiuso).length} su ${DATI.internet.length}`, spiega: "indirizzi pubblici con i dati chiusi senza password" },
    { id: "accessi", nome: "Accessi", valore: `${[DATI.accessi.chiave, ...DATI.accessi.altri].filter(a => a && a.stato === "ok").length} su ${[DATI.accessi.chiave, ...DATI.accessi.altri].filter(Boolean).length}`, spiega: "account protetti come si deve" },
    { id: "backup", nome: "Backup", valore: `${DATI.backup.filter(b => b.fuori).length} su ${DATI.backup.length}`, spiega: "app con una copia fuori casa" },
    { id: "aggiornamenti", nome: "Aggiornamenti", valore: `${DATI.versioni.filter(v => v.stato === "attenzione").length}`, spiega: "programmi da aggiornare o da controllare" },
    { id: "scadenze", nome: "Scadenze", valore: DATI.scadenze.length ? `${Math.min(...DATI.scadenze.map(s => s.giorni))} giorni` : "—", spiega: "alla prossima scadenza" },
    { id: "macchina", nome: "Salute della macchina", valore: `${DATI.macchina.filter(m => m.stato !== "ok").length}`, spiega: "parti da tenere d'occhio" }
  ];
  return `
  <div class="riga-pagina">${fonte("auto")}${fonte("claude")}</div>
  <div class="riquadro">
    <div class="eroe">
      <div class="anello ${generale}">${ic(ICONA[generale])}</div>
      <div>
        <div class="numero">${critici}</div>
        <div class="titolo">${esc(titolo)}</div>
        <p>${aperti.length} rischi aperti in tutto.${tuttoChiuso ? " Da internet non si vede niente che non dovrebbe vedersi." : " Attenzione: qualcosa è esposto più del previsto."}</p>
      </div>
    </div>
    <div class="barra-seg" role="img" aria-label="${seg.map(([s, n]) => `${n} ${plurale(s, n)}`).join(", ")}">
      ${seg.map(([s, n]) => `<span class="puntino ${s}" style="flex:${n};height:10px"></span>`).join("")}
    </div>
    <div class="legenda">${seg.map(([s, n]) => `<span><span class="puntino ${s}"></span>${n} ${plurale(s, n)}</span>`).join("")}<span class="tenue">su ${tot} controlli</span></div>
  </div>
  <div class="griglia due" style="margin-top:16px">
    <div class="riquadro">
      <h2>${ic("allarme")}Le 3 cose da fare adesso</h2>
      ${DATI.daFare.map((d, i) => `<a class="azione" href="#/rischi"><span class="n">${i + 1}</span><span><b>${esc(d.testo)}</b><span class="tenue">${esc(d.entro)}</span></span>${stato(d.livello)}</a>`).join("")}
    </div>
    <div class="riquadro">
      <h2>${ic("calendario")}Prossime scadenze <a class="a-destra" href="#/scadenze">tutte</a></h2>
      <ul class="tempo">${[...DATI.scadenze].sort((a, b) => a.giorni - b.giorni).slice(0, 3).map(s =>
        `<li><span class="segno"><span class="puntino ${s.stato}"></span></span><div class="quando">tra ${s.giorni} giorni</div><div class="cosa">${esc(s.cosa)}</div><div class="tenue">${esc(s.dettaglio)}</div></li>`).join("")}</ul>
    </div>
  </div>
  <h2 style="font-size:15px;margin:24px 0 12px">Le aree</h2>
  <div class="griglia">
    ${aree.map(a => { const s = AREE[a.id](); return `
      <a class="area" href="#/${a.id}">
        <div class="testa">${ic(VOCI[a.id].icona)}${esc(a.nome)}${stato(s)}</div>
        <div class="valore">${esc(a.valore)}</div>
        <div class="spiega">${esc(a.spiega)}</div>
      </a>`; }).join("")}
  </div>
  <div class="riquadro" style="margin-top:16px">
    <h2>${ic("libro")}Ultime modifiche <a class="a-destra" href="#/diario">diario</a></h2>
    <ul class="tempo">${DATI.diario.slice(0, 3).map(d => `<li><span class="segno"><span class="puntino info"></span></span><div class="quando">${esc(d.quando)}</div><div class="cosa">${esc(d.cosa)}</div><div class="tenue">${esc(d.dettaglio)}</div></li>`).join("")}</ul>
  </div>`;
};

PAGINE.esposizione = (sotto = "internet") => {
  const schede = [
    { id: "internet", nome: "Da internet", s: peggiore(DATI.internet.map(i => i.stato)) },
    { id: "vps", nome: "Porte della VPS", s: peggiore(DATI.porteVps.map(statoPorta)) },
    { id: "casa", nome: "Dal Wi-Fi di casa", s: peggiore(DATI.casa.map(c => c.stato)) }
  ];
  if (!schede.some(x => x.id === sotto)) sotto = "internet";
  const tab = `<div class="schede-tab">${schede.map(x => `<a href="#/esposizione/${x.id}" class="${x.id === sotto ? "attiva" : ""}"><span class="puntino ${x.s}"></span>${esc(x.nome)}</a>`).join("")}</div>`;
  const metro = (g) => { const s = g <= 14 ? "critico" : g <= 30 ? "attenzione" : "ok"; const pct = Math.max(4, Math.min(100, g / 90 * 100));
    return `<span class="metro"><span style="width:${pct}%;background:var(--${s === "ok" ? "ok" : s})"></span></span>${g} giorni`; };
  let corpo = "";
  if (sotto === "internet") corpo = `
    <p class="introduzione">Ogni indirizzo che si raggiunge da internet. Il sito controlla ogni giorno che risponda, che senza password non mostri dati e quanto manca alla scadenza del certificato. Lo stato viene solo da questo controllo; le note con la matita sono promemoria di Claude.</p>
    <div class="riga-pagina">${fonte("auto")}</div>
    <div class="riquadro"><div class="tabella"><table>
      <thead><tr><th>Indirizzo</th><th>App</th><th>Risponde</th><th>Dati chiusi</th><th>Certificato</th><th>Stato</th></tr></thead>
      <tbody>${DATI.internet.map(i => `<tr><td><b>${esc(i.nome)}</b></td><td>${esc(i.app)}</td>
        <td>${i.risponde == null ? stato("info", "—") : i.risponde ? stato("ok", "Sì") : stato("critico", "No")}</td><td>${i.chiuso == null ? stato("info", "—") : i.chiuso ? stato("ok", "Sì") : stato("critico", "No")}</td>
        <td class="num">${i.certGiorni == null ? '<span class="tenue">—</span>' : metro(i.certGiorni)}</td><td>${stato(i.stato)}${i.nota ? `<div class="tenue">${esc(i.nota)}</div>` : ""}${i.notaClaude ? `<div class="nota-claude">${ic("matita")}<span><b>Nota di Claude:</b> ${esc(i.notaClaude)}</span></div>` : ""}</td></tr>`).join("")}</tbody>
    </table></div></div>`;
  if (sotto === "vps") corpo = `
    <p class="introduzione">Le porte della VPS come le vede internet. Verde vuol dire «come deve essere». Le porte della posta non vengono provate, per non far scattare il blocco automatico sull'indirizzo di casa.</p>
    <div class="riga-pagina">${fonte("auto")}</div>
    <div class="riquadro"><h2>Devono essere aperte</h2><div class="porte">${DATI.porteVps.filter(p => p.attesa === "aperta").map(cartaPorta).join("")}</div></div>
    <div class="riquadro"><h2>Devono essere chiuse</h2><div class="porte">${DATI.porteVps.filter(p => p.attesa === "chiusa").map(cartaPorta).join("")}</div></div>`;
  if (sotto === "casa") corpo = `
    <p class="introduzione">Cosa vede chi è collegato al Wi-Fi di casa (un ospite, un dispositivo smart). «In chiaro» vuol dire che la password viaggia leggibile sulla rete di casa; dal tailnet invece è sempre cifrata.</p>
    <div class="riga-pagina">${fonte("claude")}</div>
    <div class="riquadro"><div class="tabella"><table>
      <thead><tr><th>Servizio</th><th>Protezione</th><th>Cifrato</th><th>Stato</th></tr></thead>
      <tbody>${DATI.casa.map(c => `<tr><td><b>${esc(c.cosa)}</b></td><td>${esc(c.protezione)}</td><td>${c.cifrato ? stato("ok", "Sì") : stato("attenzione", "In chiaro")}</td><td>${stato(c.stato)}${c.nota ? `<div class="tenue">${esc(c.nota)}</div>` : ""}</td></tr>`).join("")}</tbody>
    </table></div></div>`;
  return tab + corpo;
};
function cartaPorta(p) {
  if (p.trovata == null) return `<div class="porta"><span><b>${esc(p.porta)}</b> · ${esc(p.cosa)}</span>${stato("info", "Non provata")}${p.nota ? `<span class="tenue">${esc(p.nota)}</span>` : ""}</div>`;
  const giusta = p.attesa === p.trovata;
  return `<div class="porta"><span><b>${esc(p.porta)}</b> · ${esc(p.cosa)}</span>${giusta ? stato("ok", p.trovata === "aperta" ? "Aperta, giusto" : "Chiusa, giusto") : stato("critico", p.trovata === "aperta" ? "APERTA" : "Chiusa")}</div>`;
}

PAGINE.rete = (scelto = "vps") => {
  if (!DATI.rete[scelto]) scelto = "vps";
  const n = DATI.rete[scelto];
  const nodo = (id, x, y, w, h, riga1, riga2) => {
    const st = DATI.rete[id].stato, alto = h < 70;
    return `<g class="nodo${id === scelto ? " scelto" : ""}" data-nodo="${id}" tabindex="0" role="button" aria-label="${esc(DATI.rete[id].titolo)}: ${PAROLA[st]}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/>
      <circle cx="${x + w - 16}" cy="${y + 16}" r="6" fill="var(--${st})"/>
      <text x="${x + 16}" y="${y + (alto ? 24 : 33)}">${esc(riga1)}</text><text class="piccolo" x="${x + 16}" y="${y + (alto ? 43 : 55)}">${esc(riga2)}</text></g>`;
  };
  return `
  <p class="introduzione">Com'è fatto il sistema e da dove passa il traffico. Tocca un riquadro per leggere cosa fa e come è protetto. La linea tratteggiata è il traffico cifrato della rete privata (Tailscale).</p>
  <div class="riga-pagina">${fonte("claude")}</div>
  <div class="riquadro">
    <svg class="schema-rete largo" viewBox="0 0 960 420" role="group" aria-label="Schema della rete">
      <rect class="zona" x="10" y="10" width="220" height="250" rx="16" fill="var(--zona-internet)"/><text class="titolo-zona" x="28" y="36">Internet</text>
      <rect class="zona" x="270" y="10" width="250" height="250" rx="16" fill="var(--zona-vps)"/><text class="titolo-zona" x="288" y="36">In affitto · Germania</text>
      <rect class="zona" x="560" y="10" width="390" height="400" rx="16" fill="var(--zona-casa)"/><text class="titolo-zona" x="578" y="36">Casa</text>
      <rect class="zona" x="10" y="286" width="510" height="124" rx="16" fill="var(--zona-tailnet)"/><text class="titolo-zona" x="28" y="312">Ovunque, nella rete privata</text>
      <path class="filo" d="M210 118 H290"/><text class="etichetta-filo" x="226" y="106">HTTPS</text>
      <path class="filo cifrato" d="M500 118 H600"/><text class="etichetta-filo" x="526" y="106">cifrato</text>
      <path class="filo cifrato" d="M380 360 H660 V156"/><text class="etichetta-filo" x="560" y="350">cifrato</text>
      <path class="filo" d="M805 322 V156"/><text class="etichetta-filo" x="815" y="246">Wi-Fi</text>
      ${nodo("internet", 30, 80, 180, 76, "Internet", "chiunque")}
      ${nodo("vps", 290, 80, 210, 76, "VPS", "porta d'ingresso")}
      ${nodo("zimablade", 600, 80, 330, 76, "ZimaBlade", "tutte le app e i dati")}
      ${nodo("dispositivi", 30, 322, 350, 76, "I tuoi dispositivi", "Mac e telefono")}
      ${nodo("wifi", 690, 322, 230, 76, "Wi-Fi di casa", "ospiti e dispositivi")}
    </svg>
    <svg class="schema-rete stretto" viewBox="0 0 360 640" role="group" aria-label="Schema della rete">
      <rect class="zona" x="4" y="4" width="352" height="104" rx="14" fill="var(--zona-internet)"/><text class="titolo-zona" x="18" y="26">Internet</text>
      <rect class="zona" x="4" y="136" width="352" height="104" rx="14" fill="var(--zona-vps)"/><text class="titolo-zona" x="18" y="158">In affitto · Germania</text>
      <rect class="zona" x="4" y="268" width="352" height="214" rx="14" fill="var(--zona-casa)"/><text class="titolo-zona" x="18" y="290">Casa</text>
      <rect class="zona" x="4" y="510" width="352" height="126" rx="14" fill="var(--zona-tailnet)"/><text class="titolo-zona" x="18" y="532">Ovunque, nella rete privata</text>
      <path class="filo" d="M150 96 V172"/><text class="etichetta-filo" x="160" y="130">HTTPS</text>
      <path class="filo cifrato" d="M150 228 V304"/><text class="etichetta-filo" x="160" y="262">cifrato</text>
      <path class="filo" d="M150 360 V412"/><text class="etichetta-filo" x="160" y="390">Wi-Fi</text>
      <path class="filo cifrato" d="M330 568 H346 V332 H330"/><text class="etichetta-filo" x="270" y="500">cifrato</text>
      ${nodo("internet", 20, 38, 310, 58, "Internet", "chiunque")}
      ${nodo("vps", 20, 170, 310, 58, "VPS", "porta d'ingresso")}
      ${nodo("zimablade", 20, 302, 310, 58, "ZimaBlade", "tutte le app e i dati")}
      ${nodo("wifi", 20, 412, 310, 58, "Wi-Fi di casa", "ospiti e dispositivi")}
      ${nodo("dispositivi", 20, 548, 310, 58, "I tuoi dispositivi", "Mac e telefono")}
    </svg>
  </div>
  <div class="riquadro dettaglio-nodo">
    <h3>${esc(n.titolo)} ${stato(n.stato)}</h3>
    <ul>${n.righe.map(r => `<li>${esc(r)}</li>`).join("")}</ul>
  </div>`;
};

PAGINE.accessi = () => {
  const k = DATI.accessi.chiave;
  if (!k) return `<p class="introduzione">Claude non ha ancora descritto gli account.</p>` + DATI.accessi.altri.map(a => `<div class="riquadro"><h2>${ic("chiave")}${esc(a.nome)}<span class="a-destra">${stato(a.stato)}</span></h2></div>`).join("");
  return `
  <p class="introduzione">I tuoi account online sono le chiavi del sistema: chi ne prende uno entra dalla porta principale. Qui vedi quali aprono cosa e come sono protetti.</p>
  <div class="riga-pagina">${fonte("claude")}</div>
  <div class="chiave">
    <div class="capo"><div class="icona">${ic("chiave")}</div><div><b>${esc(k.nome)}</b><div class="tenue">La chiave principale · protetta con ${esc(k.protezione)}${k.confermato ? " · confermato il " + esc(k.confermato) : ""}</div></div><span style="margin-left:auto">${stato(k.stato)}</span></div>
    <div class="figli">${(k.figli || []).map(f => `<div class="figlio">${ic("lucchetto")}<span><b>${esc(f.nome)}</b> <span class="tenue">· ${esc(f.cosa)}</span></span></div>`).join("")}</div>
    <ul class="controlli">${(k.controlli || []).map(c => `<li>${stato(c.stato, c.stato === "ok" ? "Fatto" : c.stato === "info" ? "Da verificare" : "Da fare")}${esc(c.testo)}</li>`).join("")}</ul>
  </div>
  <h2 style="font-size:15px;margin:24px 0 12px">Gli altri account</h2>
  <div class="griglia">${DATI.accessi.altri.map(a => `
    <div class="riquadro" style="margin:0">
      <h2>${ic("chiave")}${esc(a.nome)}<span class="a-destra">${stato(a.stato)}</span></h2>
      <div>Apre <b>${esc(a.cosa)}</b></div>
      <div class="tenue">Protezione: ${esc(a.protezione)} · confermato il ${esc(a.confermato)}</div>
      ${a.nota ? `<div class="tenue" style="margin-top:6px">${ic("domanda")} ${esc(a.nota)}</div>` : ""}
    </div>`).join("")}</div>`;
};

PAGINE.backup = () => {
  const fuori = DATI.backup.filter(b => b.fuori).length;
  return `
  <p class="introduzione">Il RAID protegge da un disco rotto, non da cancellazioni, ransomware, furto o guasti gravi. Per questo conta la copia <b>fuori casa</b>.</p>
  <div class="riga-pagina">${fonte("claude")}</div>
  <div class="riquadro">
    <h2>${ic("archivio")}Copie fuori casa <span class="a-destra">${stato(fuori === DATI.backup.length ? "ok" : "critico", `${fuori} su ${DATI.backup.length}`)}</span></h2>
    <div class="barra-seg" role="img" aria-label="${fuori} app su ${DATI.backup.length} con una copia fuori casa" style="margin-top:4px">
      ${DATI.backup.map(b => `<span class="puntino ${b.fuori ? "ok" : "critico"}" style="flex:1;height:10px"></span>`).join("")}
    </div>
    <div class="legenda"><span><span class="puntino ok"></span>con copia fuori casa</span><span><span class="puntino critico"></span>senza</span></div>
  </div>
  <div class="riquadro"><div class="tabella"><table>
    <thead><tr><th>Cosa</th><th>Quanto pesa</th><th>Copia in casa</th><th>Copia fuori casa</th><th>Stato</th></tr></thead>
    <tbody>${DATI.backup.map(b => `<tr><td><b>${esc(b.cosa)}</b></td><td class="num">${esc(b.peso)}</td><td>${b.casa ? esc(b.casa) : '<span class="tenue">nessuna</span>'}</td><td>${b.fuori ? esc(b.fuori) : '<span class="tenue">nessuna</span>'}</td><td>${stato(b.stato)}</td></tr>`).join("")}</tbody>
  </table></div></div>`;
};

PAGINE.aggiornamenti = () => `
  <p class="introduzione">Versione installata e ultima uscita dei programmi importanti. Gli aggiornamenti di sicurezza vanno installati presto, soprattutto per quello che è su internet.</p>
  <div class="riga-pagina">${fonte("claude")}</div>
  <div class="riquadro"><div class="tabella"><table>
    <thead><tr><th>Programma</th><th>Installata</th><th>Ultima</th><th>Note</th><th>Stato</th></tr></thead>
    <tbody>${DATI.versioni.map(v => `<tr><td><b>${esc(v.nome)}</b></td><td class="num">${esc(v.installata)}</td><td class="num">${esc(v.ultima)}</td><td>${v.nota ? esc(v.nota) : '<span class="tenue">—</span>'}</td><td>${stato(v.stato)}</td></tr>`).join("")}</tbody>
  </table></div></div>`;

PAGINE.rischi = (filtro = "da-risolvere") => {
  const filtri = [
    ["da-risolvere", "Da risolvere", r => r.stato !== "risolto"], ["aperto", "Aperti", r => r.stato === "aperto"],
    ["in-corso", "In corso", r => r.stato === "in corso"], ["risolto", "Risolti", r => r.stato === "risolto"], ["tutti", "Tutti", () => true]];
  const f = filtri.find(x => x[0] === filtro) || filtri[0];
  const lista = DATI.rischi.filter(f[2]).sort((a, b) => ordine[b.livello] - ordine[a.livello]);
  const statoRischio = { aperto: ["critico", "Aperto"], "in corso": ["info", "In corso"], risolto: ["ok", "Risolto"] };
  return `
  <p class="introduzione">Quello che potrebbe andare storto, dal più grave. Apri un rischio per leggere perché conta, cosa ci protegge oggi e il prossimo passo.</p>
  <div class="riga-pagina">${fonte("claude")}</div>
  <div class="filtri">${filtri.map(([id, nome, fn]) => `<a href="#/rischi/${id}" class="${id === f[0] ? "attivo" : ""}">${esc(nome)}<span class="conteggio">${DATI.rischi.filter(fn).length}</span></a>`).join("")}</div>
  ${lista.length ? lista.map((r, i) => {
    const [sc, sn] = statoRischio[r.stato]; const colore = r.stato === "risolto" ? "ok" : r.livello;
    return `<details class="rischio ${colore}"${i === 0 && r.stato !== "risolto" ? " open" : ""}>
      <summary><b>${esc(r.titolo)}</b><span class="etichette">${stato(r.livello)}${stato(sc, sn)}</span>
        <span class="sotto">${r.entro !== "—" ? "Prossimo passo entro " + esc(r.entro) : "Nessuna azione aperta"}</span></summary>
      <div class="corpo">
        <div><h4>Perché conta</h4>${esc(r.perche)}</div>
        <div><h4>Cosa ci protegge oggi</h4>${esc(r.oggi)}</div>
        <div><h4>Prossimo passo</h4>${esc(r.prossimo)}</div>
      </div></details>`; }).join("") : '<div class="riquadro tenue">Nessun rischio in questo elenco.</div>'}`;
};

PAGINE.scadenze = () => `
  <p class="introduzione">Cosa scade e quando, dalla più vicina. I certificati si rinnovano da soli: il sito avvisa se un rinnovo non è avvenuto.</p>
  <div class="riga-pagina">${fonte("auto")}${fonte("claude")}</div>
  <div class="riquadro"><ul class="tempo">${[...DATI.scadenze].sort((a, b) => a.giorni - b.giorni).map(s => `
    <li><span class="segno"><span class="puntino ${s.stato}"></span></span>
      <div class="quando">tra</div><div class="giorni">${s.giorni} giorni</div>
      <div class="cosa">${esc(s.cosa)} ${stato(s.stato)}</div><div class="tenue">${esc(s.dettaglio)}</div></li>`).join("")}</ul></div>`;

PAGINE.macchina = () => `
  <p class="introduzione">Lo stato fisico del server. Il sito non può guardare dentro la macchina: questi dati li aggiorna Claude quando controlla.</p>
  <div class="riga-pagina">${fonte("claude")}</div>
  <div class="griglia">${DATI.macchina.map(m => `
    <div class="area" style="cursor:default">
      <div class="testa">${ic("chip")}${esc(m.titolo)}${stato(m.stato)}</div>
      <div class="valore">${esc(m.valore)}</div>
      <div class="spiega">${esc(m.testo)}</div>
      <div class="tenue" style="margin-top:8px">Controllato il ${esc(m.quando)}</div>
    </div>`).join("")}</div>`;

PAGINE.diario = () => `
  <p class="introduzione">Le modifiche fatte al sistema, sempre con il tuo OK.</p>
  <div class="riga-pagina">${fonte("claude")}</div>
  <div class="riquadro"><ul class="tempo">${DATI.diario.map(d => `<li><span class="segno"><span class="puntino info"></span></span><div class="quando">${esc(d.quando)}</div><div class="cosa">${esc(d.cosa)}</div><div class="tenue">${esc(d.dettaglio)}</div></li>`).join("")}</ul></div>`;

PAGINE.domande = () => `
  <p class="introduzione">Le cose che mi servono sapere da te. Rispondi pure in chat: le tolgo da qui appena so la risposta.</p>
  <div class="riga-pagina">${fonte("claude")}</div>
  <div class="griglia due">${DATI.domande.map(d => `
    <div class="riquadro" style="margin:0"><h2>${ic("domanda")}${esc(d.testo)}</h2><div class="tenue">Dove guardare: ${esc(d.dove)} · chiesta il ${esc(d.quando)}</div></div>`).join("")}</div>`;

/* ===================== NAVIGAZIONE ===================== */
function vai() {
  const [id, sotto] = (location.hash.replace(/^#\/?/, "") || "panoramica").split("/");
  const voce = VOCI[id] ? id : "panoramica";
  const avvisoStato = DATI.erroreStato ? `<div class="avviso-stato">${ic("attenzione")} <b>Il file di stato di Claude è ${esc(DATI.erroreStato)}.</b> Le parti «aggiornate da Claude» sono vuote finché Claude non lo scrive di nuovo.</div>` : "";
  document.getElementById("pagina").innerHTML = avvisoStato + PAGINE[voce](sotto) +
    `<footer class="piede">${ic("lucchetto")}Nessuna password, chiave o token in questa pagina · visibile solo dal tuo account Tailscale · il sito legge e basta, non può cambiare niente${INFO.versione ? " · versione " + esc(INFO.versione) : ""}</footer>`;
  document.getElementById("titolo").textContent = VOCI[voce].nome;
  document.getElementById("percorso").textContent = VOCI[voce].gruppo || "Sicurezza di casa";
  document.title = VOCI[voce].nome + " · Sicurezza di casa";
  disegnaMenu(voce);
  document.body.classList.remove("menu-aperto");
  document.querySelectorAll(".schema-rete .nodo").forEach(g => {
    const apri = () => { location.hash = "#/rete/" + g.dataset.nodo; };
    g.addEventListener("click", apri);
    g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); apri(); } });
  });
  if (!sotto) window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => { if (DATI) vai(); });
document.getElementById("apriMenu").addEventListener("click", () => document.body.classList.add("menu-aperto"));
document.getElementById("sfondoMenu").addEventListener("click", () => document.body.classList.remove("menu-aperto"));

/* controllo a richiesta: il sito rifà subito i suoi controlli automatici (al massimo uno al minuto)
   e qui si seguono i passi. Le parti «aggiornate da Claude» non cambiano: quelle le aggiorna Claude. */
let inCorso = false;
const pausa = ms => new Promise(r => setTimeout(r, ms));
const api = (url, opz = {}) => fetch(url, { ...opz, credentials: "same-origin", headers: { "X-SC": "1", ...(opz.headers || {}) } });
function disegnaAvviso(fatti, esito, errore) {
  const av = document.getElementById("avviso"), passi = INFO.passi || [];
  av.className = "avviso visibile";
  const testa = esito ? (errore ? ic("critico") + "Controllo non riuscito" : ic("ok") + "Controllo finito") : ic("aggiorna") + "Controllo in corso…";
  av.innerHTML = `<h3>${testa}${esito ? '<button class="chiudi" id="chiudiAvviso" aria-label="Chiudi">×</button>' : ""}</h3>
    <ul>${passi.map((t, i) => `<li class="${i < fatti ? "fatto" : i === fatti && !esito ? "ora" : ""}"><span class="segnale">${i < fatti ? ic("ok") : i === fatti && !esito ? '<span class="gira">' + ic("aggiorna") + "</span>" : '<span class="puntino info"></span>'}</span>${esc(t)}</li>`).join("")}</ul>
    ${esito ? `<div class="esito">${esc(esito)}${errore ? "" : ' <a href="#/esposizione">Vedi Esposizione</a>'}</div>` : ""}`;
  const c = document.getElementById("chiudiAvviso"); if (c) c.addEventListener("click", () => { av.className = "avviso"; });
}
function bottoneOccupato(si) {
  const b = document.getElementById("controlla");
  b.disabled = si; b.classList.toggle("gira", si);
  document.getElementById("controllaTesto").textContent = si ? "Controllo in corso…" : "Controlla adesso";
}
async function controllaAdesso() {
  if (inCorso) return;
  inCorso = true; bottoneOccupato(true); disegnaAvviso(0);
  try {
    const r = await api("/api/controlla", { method: "POST" });
    if (!r.ok && r.status !== 409) { const e = await r.json().catch(() => ({})); disegnaAvviso(0, e.error || "Il controllo non è partito.", true); return; }
    for (let giri = 0; giri < 400; giri++) {
      await pausa(600);
      const s = await (await api("/api/controllo")).json();
      if (s.inCorso) { disegnaAvviso(s.passo); continue; }
      await carica();
      disegnaAvviso((INFO.passi || []).length, (s.fine && s.fine.esito) || "Controllo finito.", s.fine && s.fine.errore);
      return;
    }
    disegnaAvviso(0, "Il controllo sta durando troppo: riprova tra qualche minuto.", true);
  } catch {
    disegnaAvviso(0, "Collegamento con il sito perso: ricarica la pagina.", true);
  } finally {
    inCorso = false; bottoneOccupato(false);
  }
}
document.getElementById("controlla").addEventListener("click", controllaAdesso);

/* tema: auto → chiaro → scuro (ricordato sul dispositivo, se il browser lo permette) */
const TEMI = ["auto", "light", "dark"], NOMI_TEMA = { auto: "Auto", light: "Chiaro", dark: "Scuro" };
let tema = "auto";
try { tema = localStorage.getItem("tema") || "auto"; } catch {}
function applicaTema() {
  if (tema === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", tema);
  document.getElementById("temaNome").textContent = NOMI_TEMA[tema];
}
document.getElementById("tema").addEventListener("click", () => {
  tema = TEMI[(TEMI.indexOf(tema) + 1) % TEMI.length];
  try { localStorage.setItem("tema", tema); } catch {}
  applicaTema();
});
applicaTema();
async function carica() {
  const r = await fetch("/api/stato", { credentials: "same-origin" });
  if (!r.ok) throw new Error("stato " + r.status);
  const j = await r.json();
  INFO = { versione: j.versione, passi: (j.controllo && j.controllo.passi) || [] };
  DATI = costruisci(j);
  vai();
}
carica().catch(() => { document.getElementById("pagina").innerHTML = '<div class="riquadro">Non riesco a leggere lo stato dal sito. Ricarica la pagina tra poco.</div>'; });
setInterval(() => { if (!inCorso && !document.hidden) carica().catch(() => {}); }, 5 * 60 * 1000);
