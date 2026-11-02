// Función serverless (Vercel): VISOR de nadadores de Narvales en la base FECNA (Supabase, esquema `fecna`).
// Solo LECTURA (usuario suite_lector, variable cifrada FECNA_DB_URL) y solo del club NARVALES BOGOTA.
// Responde únicamente a quien entró a SwimTracker Pro: valida el token de sesión de Firebase en cada llamada
// (son datos de menores; sin sesión no se entrega nada). No escribe en ningún lado.
//   GET /api/fecna?q=texto  → buscar por nombre (hasta 25)
//   GET /api/fecna?id=N     → ficha + todas sus marcas en piscina larga (para Análisis)
const FIREBASE_KEY = 'AIzaSyB__TYUly11LiwpAAZY0s66Fp6uKnfi6p0';   // clave web pública de la app (la misma de index.html)
const CLUB = 'NARVALES BOGOTA';
let sql = null;
function db() {
  if (!sql) {
    if (!process.env.FECNA_DB_URL) throw new Error('falta configurar FECNA_DB_URL en Vercel');
    const postgres = require('postgres');
    sql = postgres(process.env.FECNA_DB_URL, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 8 });
  }
  return sql;
}
async function sesionValida(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  try {
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_KEY,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: m[1] }) });
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j.users && j.users.length);
  } catch (e) { return false; }
}
const norm = t => String(t || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-ZÑ0-9 ]/g, ' ').trim();

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await sesionValida(req))) { res.status(401).json({ error: 'Inicia sesión en SwimTracker Pro.' }); return; }
  const q = req.query || {};
  try {
    const s = db();
    if (q.id) {
      const id = String(q.id).trim();
      const info = (await s`select n.id, n.nada, n.genero, n.liga, n.fecha_nac::text as nac from fecna.nadadores n
        where n.id = ${id} and n.club = ${CLUB} limit 1`)[0];
      if (!info) { res.status(404).json({ error: 'No está en la base como nadador de Narvales.' }); return; }
      const marcas = await s`select r.prueba_id as pid, r.segundos::float as seg, r.edad, r.puntos, t.id as tid, t.nombre as torneo, t.fecha::text as fecha
        from fecna.resultados r join fecna.torneos t on t.id = r.torneo_id
        where r.nadador_id = ${id} and r.piscina = 'LC' and not r.sospechoso order by t.fecha, r.prueba_id`;
      // la FECNA carga algunos torneos dos veces (versión "Abierto" y "Categorías") con la MISMA carrera:
      // misma prueba + misma fecha + mismo tiempo = una sola marca (eliminatoria y final del mismo día sí quedan, son tiempos distintos)
      const vistas = new Set(), unicas = marcas.filter(x => { const k = x.pid + '|' + x.fecha + '|' + x.seg; if (vistas.has(k)) return false; vistas.add(k); return true; });
      res.status(200).json({ info, marcas: unicas.map(x => ({ ...x, puntos: +x.puntos || 0 })) });
      return;
    }
    const toks = norm(q.q).split(/\s+/).filter(t => t.length >= 2).slice(0, 4);
    if (!toks.length) { res.status(400).json({ error: 'Escribe al menos 2 letras del nombre.' }); return; }
    const cond = toks.reduce((acc, t) => s`${acc} and translate(upper(n.nada), 'ÁÉÍÓÚÜ', 'AEIOUU') like ${'%' + t + '%'}`, s``);
    const rows = await s`select n.id, n.nada, n.genero, n.fecha_nac::text as nac, max(t.fecha)::text as ultima, count(r.*)::int as marcas
      from fecna.nadadores n left join fecna.resultados r on r.nadador_id = n.id and not r.sospechoso left join fecna.torneos t on t.id = r.torneo_id
      where n.club = ${CLUB} ${cond}
      group by n.id, n.nada, n.genero, n.fecha_nac order by max(t.fecha) desc nulls last limit 25`;
    res.status(200).json({ nadadores: rows });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e).slice(0, 160) });
  }
};
