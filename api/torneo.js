// Función serverless (Vercel): lee un torneo Hy-Tek (Liga de Natación de Bogotá) del
// lado del servidor y devuelve JSON limpio. v2: sesiones/fechas por evento + DQ/NS.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const STROKE = { Freestyle:'Libre', Backstroke:'Espalda', Breaststroke:'Pecho', Butterfly:'Mariposa', IM:'Combinado', Medley:'Combinado',
  Free:'Libre', Back:'Espalda', Breast:'Pecho', Fly:'Mariposa' };
const STAT = /^(DQ|DNS|DFS|DNF|SCR|NS|X)$/;

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' en ' + url);
  return Buffer.from(await r.arrayBuffer()).toString('latin1');
}
function parseIndex(html) {
  const out = [];
  let session = null, dow = null, date = null;
  const re = /<h3>\s*Session\s*([^<\r\n]*?)\s*(?:<br[^>]*>)?\s*[\r\n]+\s*([A-Za-zÀ-ÿ]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})|<a href="([^"]+\.htm)"[^>]*>\s*#(\d+)\s*(.*?)\s*<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[4]) out.push({ file:m[4], num:+m[5], title:m[6].replace(/\s+/g,' ').trim(), session, dow, date });
    else { session = (m[1]||'').replace(/\s+/g,' ').trim(); dow = m[2]; date = m[3]; }
  }
  return out;
}
function parseTitle(t) {
  const gender = /^Women|^Girls/i.test(t) ? 'F' : (/^Men|^Boys/i.test(t) ? 'M' : '?');
  const relay = /Relay/i.test(t);
  let dist = null, stroke = null, age = null;
  const m = t.match(/^(?:Women|Men|Girls|Boys)\s+(.*?)\s+(\d+)\s+(?:LC|SC)\s+Meter\s+(.+)$/i)
        || t.match(/^(?:Women|Men|Girls|Boys)\s+(.*?)\s+(\d*x?\d+)\s+(.+)$/i);
  if (m) { age = m[1].replace(/Year Olds?/i,'').replace(/\s+/g,' ').trim(); dist = m[2]; stroke = STROKE[m[3].trim()] || m[3].trim(); }
  return { gender, age, dist, stroke, relay, label: dist ? (dist + ' m ' + stroke) : t };
}
function parseRows(pre) {
  const rows = []; const clean = pre.replace(/<[^>]+>/g, '');
  for (const raw of clean.split('\n')) {
    const line = raw.replace(/\r/, '');
    const m = line.match(/^\s*(\d+|-{2,})\s+(.+?)\s+(\d{1,2})\s+([A-Za-z][A-Za-z0-9.\-]{1,6})\s+(.*)$/);
    if (!m) continue;
    const toks = m[5].match(/\d{0,2}:?\d{1,2}\.\d{2}|NT|DQ|DNS|DFS|DNF|SCR|NS/g) || [];
    if (!toks.length) continue;
    let seed = toks[0], finals = toks[1] || null, status = null;
    if (finals && STAT.test(finals)) { status = finals; finals = null; }
    if (STAT.test(seed)) { status = status || seed; seed = null; }
    rows.push({ pos: /^\d+$/.test(m[1]) ? +m[1] : null, name:m[2].trim(), age:+m[3], club:m[4].trim(), seed, finals, status });
  }
  return rows;
}
function parseRelayRows(pre) {
  // Relevos: fila del equipo = "pos  CLUB  'A'  seed  finals  puntos" + líneas "1) Nombre 2) Nombre…"
  const rows = []; const clean = pre.replace(/<[^>]+>/g, '');
  let cur = null; const push = () => { if (cur) rows.push(cur); cur = null; };
  for (const raw of clean.split('\n')) {
    const line = raw.replace(/\r/, '');
    const m = line.match(/^\s*(\d+|-{2,})\s+(\S.*?)\s+'([A-Za-z])'\s+(.*)$/);
    if (m) {
      push();
      const toks = m[4].match(/[xX]?\d{0,2}:?\d{1,2}\.\d{2}|NT|DQ|DNS|DFS|DNF|SCR|NS/g) || [];
      let seed = toks[0] || null, finals = toks[1] || null, status = null, exhibition = false;
      if (finals && /^[xX]/.test(finals)) { exhibition = true; finals = finals.replace(/^[xX]/, ''); }
      if (finals && STAT.test(finals)) { status = finals; finals = null; }
      if (seed && STAT.test(seed)) { status = status || seed; seed = null; }
      cur = { pos: /^\d+$/.test(m[1]) ? +m[1] : null, name: m[2].trim(), club: m[2].trim(), team: m[3], seed, finals, status, exhibition, relay: true, swimmers: [] };
      continue;
    }
    if (cur && /^\s*\d\)/.test(line)) {
      for (let s of line.split(/\s*\d\)\s*/).map(x => x.trim()).filter(Boolean)) {
        s = s.replace(/\s+\d{1,2}$/, '').trim(); if (s) cur.swimmers.push(s);
      }
    }
  }
  push();
  return rows.filter(r => r.finals || r.status);
}
function parseMeta(pre) {
  const meetM = pre.match(/\n\s*(\d{4}[^\n]*?)\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}/);
  const genM = pre.match(/(\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*\d{1,2}:\d{2}\s*[AP]M)/i);
  return { meet: meetM ? meetM[1].trim() : 'Torneo', generated: genM ? genM[1].trim() : null };
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; } }
  }));
  return out;
}
async function scrapeMeet(baseUrl) {
  const base = baseUrl.replace(/\/?$/, '/');
  const idx = parseIndex(await get(base + 'evtindex.htm'));
  let meta = { meet: 'Torneo', generated: null };
  const events = await mapLimit(idx, 8, async (e) => {
    const html = await get(base + e.file);
    const pre = (html.match(/<pre>([\s\S]*?)<\/pre>/i) || [, ''])[1];
    if (!meta.generated) { const mt = parseMeta(pre); if (mt.generated) meta = mt; }
    const p = parseTitle(e.title);
    return { num:e.num, gender:p.gender, age:p.age, label:p.label, relay:p.relay, title:e.title,
             session:e.session, dow:e.dow, date:e.date, rows: p.relay ? parseRelayRows(pre) : parseRows(pre) };
  });
  return { ...meta, updatedAt: new Date().toISOString(), base, events: events.filter(Boolean) };
}

// ── colombiaacuatica.com (torneos FECNA fuera de la Liga de Bogotá) ──────────────────────────────────────────
// Link de la página del torneo (colombiaacuatica.com/c/NNN) → backtun/torneos/AAAA/CODIGO/. Mientras se nada publica
// los resultados EN VIVO como reportes HTML (pestaña Resultados → "Resultado por número de Prueba"); el PDF oficial
// solo sale al final. Los reportes siguen disponibles después, así que este lector sirve durante y después.
// Pedirlos: cookie de index.php → POST datos={¬nCodReporte¬:…} (página "a", formulario) → POST del formulario ("b").
// Validado (30-oct-2026) contra el PDF oficial de 3 torneos terminados: mismos tiempos y puestos.
const CA = 'https://www.colombiaacuatica.com/';
const CA_STROKE = { Libre: 'Libre', Espalda: 'Espalda', Pecho: 'Pecho', Mariposa: 'Mariposa', Comb: 'Combinado', 'Comb.Ind': 'Combinado', CI: 'Combinado' };
const caTxt = h => String(h || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const caCelda = (h, et) => { const i = h.indexOf('>' + et); if (i < 0) return ''; const j = h.indexOf('</div>', i); return caTxt(h.slice(i + et.length + 1, j < 0 ? undefined : j)); };
// "MORA bueno danna salome" (apellidos primero) → "Danna Salome Mora Bueno" (así lo busca la casilla de la nadadora)
const caNombre = n => { const t = String(n || '').trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()); return t.length >= 3 ? t.slice(2).concat(t.slice(0, 2)).join(' ') : t.join(' '); };
// "13 YEARS" → edad 13 · "JNR 18Y-20Y" → "Junior 18-20" · "21Y +" → "21+" · "10Y AND OVER" → "10+"
function caCat(c) {
  const s = String(c || '').toUpperCase().trim(); let m;
  if ((m = s.match(/^(\d+)\s*YEARS?$/))) return { age: +m[1], cat: null };
  const t = s.replace(/\bJNR\b/, 'Junior').replace(/\bJV A\b/, 'Juvenil A').replace(/\bJV B\b/, 'Juvenil B').replace(/\bINF A\b/, 'Infantil A').replace(/\bINF B\b/, 'Infantil B')
    .replace(/(\d+)Y\s*AND\s*OVER/, '$1+').replace(/(\d+)Y\s*\+/, '$1+').replace(/(\d+)Y?\s*-\s*(\d+)Y/, (_, a, b) => +a + '-' + +b).replace(/(\d+)Y\b/, '$1').replace(/\bOPEN\b/, 'Abierta');
  m = t.match(/^(\d+)$/); if (m) return { age: +m[1], cat: null };
  m = t.match(/^\D+ (\d+)$/); return { age: m ? +m[1] : null, cat: t };   // "Juvenil A 14" → edad 14 (para la mínima)
}
async function caSesion(link) {
  const m = String(link).match(/colombiaacuatica\.com\/c\/(\d+)/i);
  let B;
  if (m) {
    const r = await fetch(CA + 'c/' + m[1], { headers: { 'User-Agent': UA }, redirect: 'manual' });
    const loc = r.headers.get('location') || ''; const c = loc.match(/backtun\/torneos\/(\d{4})\/(\d{8})\//i);
    if (!c) throw new Error('No encontré el código del torneo en ese link de colombiaacuatica');
    B = CA + 'backtun/torneos/' + c[1] + '/' + c[2] + '/';
  } else {
    const c = String(link).match(/backtun\/torneos\/(\d{4})\/(\d{8})\//i);
    if (!c) throw new Error('Pega el link de la página del torneo (colombiaacuatica.com/c/NUMERO)');
    B = CA + 'backtun/torneos/' + c[1] + '/' + c[2] + '/';
  }
  const r = await fetch(B + 'index.php', { headers: { 'User-Agent': UA } });
  const ck = (r.headers.get('set-cookie') || '').split(';')[0];
  const H = { 'User-Agent': UA, Cookie: ck, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' };
  const post = async (url, body) => { const x = await fetch(url, { method: 'POST', headers: H, body }); if (!x.ok) throw new Error('HTTP ' + x.status + ' en ' + url); return x.text(); };
  const lis = await (await fetch(B + 'listadoreportes.php', { headers: H })).text();
  const reportes = [...lis.matchAll(/EnviaDatosJSON\('(.*?)', '(.*?)'/g)].map(x => {
    const datos = x[1].replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, '$1');
    return { nombre: (datos.match(/sNombreReporte¬:¬(.*?)¬/) || [])[1] || '', url: x[2], datos };
  });
  // abre un reporte por NOMBRE (paranatación usa otros códigos) → su HTML y cómo enviar su formulario
  const abrir = async re => {
    const rp = reportes.find(x => re.test(x.nombre)); if (!rp) return null;
    const a = await post(rp.url, 'datos=' + rp.datos);
    const act = (a.match(/EnviaDatos\('[^']*',\s*'([^']+)'/) || [])[1];
    const ocultos = new URLSearchParams();
    for (const x of a.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) { const n = (x[0].match(/name="([^"]+)"/) || [])[1]; if (n) ocultos.set(n, (x[0].match(/value="([^"]*)"/) || [])[1] || ''); }
    return { a, enviar: act ? campos => { const b = new URLSearchParams(ocultos); for (const [k, v] of Object.entries(campos)) b.set(k, v); return post(act.startsWith('http') ? act : CA + act, b); } : null };
  };
  return { B, H, abrir };
}
function caEvento(html) {
  let ev = null;
  for (const sec of html.split(/Evento #\s*/).slice(1)) {
    const cab = caTxt(sec.slice(0, sec.indexOf('</div>'))).split('|').map(x => x.trim());   // 5 | FEMENINO | 50m Mariposa/50m Fly | 10 YEARS | F
    const pm = (cab[2] || '').match(/^(?:(\d+)X)?(\d+)m ([^/]+?)\s*\//i); if (!pm) continue;
    const k = pm[3].trim().replace(/\.$/, ''), stroke = CA_STROKE[k] || CA_STROKE[k.split(/[.\s]/)[0]] || k;
    const relay = !!pm[1], dist = relay ? pm[1] + 'x' + pm[2] : pm[2];
    if (!ev) ev = { num: +cab[0], gender: /^FEM/i.test(cab[1]) ? 'F' : /^MAS/i.test(cab[1]) ? 'M' : 'X', age: null, label: dist + ' m ' + stroke, relay,
      title: cab.slice(1).join(' | '), session: null, dow: null, date: null, rows: [], cats: [] };
    const cc = caCat(cab[3]); ev.cats.push(cc.cat || (cc.age + ' años'));
    for (const fh of sec.split(/<span class="font-weight-bold d-sm-none">Puesto:\s*<\/span>/).slice(1)) {
      const pos = parseInt(caTxt(fh.slice(0, fh.indexOf('</div>')))) || null;
      const eq = caCelda(fh, 'Equipo:</span>').split('/'), club = (eq[1] || '').trim().toUpperCase();
      let t = caCelda(fh, 'Tiempo:</span>').replace(/\.$/, ''); if (/^N\.?S$/i.test(t)) t = 'NS';
      const ins = caCelda(fh, 'T.Insc:</span>') || null, stat = /^(DQ|NS|DNS|DNF|SCR)$/i.test(t) ? t.toUpperCase() : null;
      const nom = caCelda(fh, 'Nombre:</span>');
      const row = { pos, name: relay ? club : caNombre(nom), age: cc.age, cat: cc.cat, club, seed: ins, finals: stat || !t ? null : t, status: stat };
      if (relay) { row.relay = true; row.team = ''; row.swimmers = nom.split('|').slice(1).map(s => s.trim()); }
      ev.rows.push(row);
    }
  }
  if (!ev) return null;
  // prueba en curso: aún no hay puestos y "N.S" = todavía no ha nadado → se deja pendiente (sin tiempo ni estado)
  const cerrada = ev.rows.some(r => r.pos);
  if (!cerrada) { for (const r of ev.rows) if (r.status === 'NS') r.status = null; }
  else { for (const r of ev.rows) if (!r.finals && !r.status) r.status = 'NS'; }   // cerrada y sin tiempo = no nadó
  ev.age = [...new Set(ev.cats)].length > 4 ? 'Varias categorías' : [...new Set(ev.cats)].join(', ');
  ev.enCurso = !cerrada && ev.rows.some(r => r.finals || r.status);
  delete ev.cats;
  return ev;
}
async function scrapeColombiaAcuatica(link) {
  const S = await caSesion(link);
  let meet = 'Torneo';
  try {   // "CLUB … Torneo Interclubes Tiburón Dorado 30 de octubre al 01 de noviembre de 2026 TOL, Ibague Inicio …"
    const t = caTxt(await (await fetch(S.B + 'pageindex00.php', { headers: S.H })).text());
    const m = t.match(/\s(\d{1,2}(?: de \w+)?\s*(?:-|al?)\s*\d{1,2} de \w+ de \d{4}|\d{1,2} de \w+ de \d{4})\s/);
    if (m) meet = t.slice(0, m.index).replace(/^.*?\b(?=(?:[IVXL]+ |\d+[ªa°]? )?(?:Torneo|Copa|Festival|Campeonato|Juegos|Chequeo|Interclubes|Departamental|Intercolegiado))/, '').trim() + ' · ' + m[1];
  } catch (e) { /* sin encabezado */ }
  const rp = await S.abrir(/n[uú]mero de prueba/i);
  if (!rp || !rp.enviar) return { meet, generated: null, updatedAt: new Date().toISOString(), base: S.B, fuente: 'colombiaacuatica', events: [] };
  const lista = [...rp.a.matchAll(/<option value="(\d+)">\s*(\d+)\s*\|/g)].map(m => m[1]);
  const events = await mapLimit(lista, 8, async id => caEvento(await rp.enviar({ nTpruId: id })));
  return { meet, generated: null, updatedAt: new Date().toISOString(), base: S.B, fuente: 'colombiaacuatica', events: events.filter(Boolean) };
}

module.exports = async (req, res) => {
  // CORS: permite que un HTML local (p.ej. el generador de resúmenes) consuma el lector.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const url = (req.query && req.query.url) || 'https://aquaticsports.co/results/2026/0003/';
  // Lectores soportados: Hy-Tek (Liga de Natación de Bogotá y aquaticsports.co) y colombiaacuatica.com. Se elige solo por el link.
  const esCA = /^https?:\/\/(www\.)?colombiaacuatica\.com\//i.test(url);
  if (!esCA && !/^https?:\/\/[^/]*(liganatacionbogota\.com|aquaticsports\.co)\//i.test(url)) {
    res.status(400).json({ error: 'URL no válida (debe ser de liganatacionbogota.com, aquaticsports.co o colombiaacuatica.com).' });
    return;
  }
  try {
    const data = esCA ? await scrapeColombiaAcuatica(url) : await scrapeMeet(url);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.status(200).send(JSON.stringify(data));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
