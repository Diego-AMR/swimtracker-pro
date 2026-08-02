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
             session:e.session, dow:e.dow, date:e.date, rows: parseRows(pre) };
  });
  return { ...meta, updatedAt: new Date().toISOString(), base, events: events.filter(Boolean) };
}

module.exports = async (req, res) => {
  const url = (req.query && req.query.url) || 'https://resultados.liganatacionbogota.com/2026/0014/';
  if (!/^https?:\/\/[^/]*liganatacionbogota\.com\//i.test(url)) {
    res.status(400).json({ error: 'URL no válida (debe ser de liganatacionbogota.com).' });
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
