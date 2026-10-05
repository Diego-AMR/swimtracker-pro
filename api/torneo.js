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

module.exports = async (req, res) => {
  // CORS: permite que un HTML local (p.ej. el generador de resúmenes) consuma el lector.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const url = (req.query && req.query.url) || 'https://aquaticsports.co/results/2026/0003/';
  // Lectores Hy-Tek soportados: Liga de Natación de Bogotá y aquaticsports.co (FECNA/ligas).
  if (!/^https?:\/\/[^/]*(liganatacionbogota\.com|aquaticsports\.co)\//i.test(url)) {
    res.status(400).json({ error: 'URL no válida (debe ser de liganatacionbogota.com o aquaticsports.co).' });
    return;
  }
  try {
    const data = await scrapeMeet(url);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.status(200).send(JSON.stringify(data));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
