/* Interfaz: descarga de velas de OKX (con caché en el navegador), formulario de estrategia y analizador. */
"use strict";
const $ = (s) => document.querySelector(s);
const DAY = 864e5;
const OKX = "https://www.okx.com/api/v5/market/history-candles";
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }) : "∞");
const pct = (x, d = 1) => `${fmt(x * 100, d)}%`;
const fecha = (t) => new Date(t).toISOString().slice(0, 10);
const fechaHora = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ultimo = null;   // {res, params, velas}
const charts = {};

/* ---------- Caché de velas (IndexedDB) ---------- */
function db() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open("banco-backtests", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("velas");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
async function cacheGet(k) {
  try { const d = await db(); return await new Promise((ok) => { const q = d.transaction("velas").objectStore("velas").get(k); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }); }
  catch { return null; }
}
async function cachePut(k, v) {
  try { const d = await db(); d.transaction("velas", "readwrite").objectStore("velas").put(v, k); } catch { /* sin caché: se descargará otra vez */ }
}

const instId = (sym) => (sym.includes("-") ? sym : `${sym}-USDT-SWAP`).toUpperCase();

// Velas cerradas de [desde, hasta) paginando hacia atrás (100 por petición; OKX permite unas 10 por segundo).
async function bajar(inst, bar, desde, hasta, avisar) {
  const out = [];
  let after = hasta;
  for (let n = 1; ; n++) {
    const r = await fetch(`${OKX}?instId=${inst}&bar=${bar}&limit=100&after=${after}`);
    const j = await r.json();
    if (j.code === "50011") { await sleep(1000); continue; }  // límite de peticiones: espera y repite
    if (j.code !== "0") throw new Error(`OKX (${inst}): ${j.msg || j.code}`);
    if (!j.data.length) break;
    for (const k of j.data) if (k[8] === "1") out.push([+k[0], +k[1], +k[2], +k[3], +k[4]]);
    after = j.data[j.data.length - 1][0];
    avisar(`${inst} ${bar}: ${fecha(+after)} (${n} páginas)`);
    if (+after < desde) break;
    await sleep(110);
  }
  return out.filter((k) => k[0] >= desde);
}

async function velas(sym, bar, desde, hasta, avisar) {
  const inst = instId(sym), key = `${inst}|${bar}`, tf = Motor.TF_MS[bar];
  const ahora = Math.floor(Date.now() / tf) * tf;
  hasta = Math.min(hasta, ahora);
  let c = await cacheGet(key);
  if (!c) c = { desde: hasta, hasta, filas: [] };
  const trozos = [];
  if (desde < c.desde) trozos.push(await bajar(inst, bar, desde, c.desde, avisar));
  if (hasta > c.hasta) trozos.push(await bajar(inst, bar, c.hasta, hasta, avisar));
  if (trozos.length) {
    const m = new Map(c.filas.map((k) => [k[0], k]));
    for (const t of trozos) for (const k of t) m.set(k[0], k);
    c = { desde: Math.min(desde, c.desde), hasta: Math.max(hasta, c.hasta), filas: [...m.values()].sort((a, b) => a[0] - b[0]) };
    await cachePut(key, c);
  } else avisar(`${inst} ${bar}: en caché`);
  return c.filas.filter((k) => k[0] >= desde && k[0] < hasta).map(([t, o, h, l, cl]) => ({ t, o, h, l, c: cl }));
}

/* ---------- Formulario ---------- */
const CAMPOS = ["tf", "capital", "rapida", "lenta", "tendencia", "atrN", "atrMult", "direccion", "maxAbiertas", "maxApal",
  "fuerzaVelas", "fuerzaExcluir", "parRegimen", "regRapida", "regLenta"];
const PCT = ["riesgo", "perdidaDiaria", "maker", "taker"];
const CHECKS = ["salidaCompleta", "sinFinde", "fuerza", "regimen"];

function rellenar(p) {
  $("#pares").value = p.pares.join(", ");
  for (const k of CAMPOS) $(`#${k}`).value = p[k];
  for (const k of PCT) $(`#${k}`).value = +(p[k] * 100).toFixed(4);
  for (const k of CHECKS) $(`#${k}`).checked = p[k];
  [$("#hAL").value, $("#hAC").value] = p.huecosAlcista;
  [$("#hBL").value, $("#hBC").value] = p.huecosBajista;
  activar();
}
function leer() {
  const p = { pares: $("#pares").value.split(/[,\s]+/).filter(Boolean).map((x) => x.toUpperCase()),
    desde: $("#desde").value, hasta: $("#hasta").value };
  for (const k of CAMPOS) { const v = $(`#${k}`).value; p[k] = isNaN(+v) || v === "" ? v : +v; }
  for (const k of PCT) p[k] = +$(`#${k}`).value / 100;
  for (const k of CHECKS) p[k] = $(`#${k}`).checked;
  p.huecosAlcista = [+$("#hAL").value, +$("#hAC").value];
  p.huecosBajista = [+$("#hBL").value, +$("#hBC").value];
  const sel = $("#preset");
  p.nombre = sel.value === "propia" ? "Estrategia propia" : PRESETS[sel.value].nombre;
  return p;
}
function activar() {  // deja visibles solo los ajustes que se usan
  $("#bloqueFuerza").disabled = !$("#fuerza").checked;
  $("#bloqueRegimen").disabled = !$("#regimen").checked;
  $("#maxAbiertas").disabled = $("#regimen").checked;
}

async function lanzar(e) {
  e.preventDefault();
  const p = leer(), boton = $("#lanzar"), estado = $("#estado");
  if (!p.pares.length) return (estado.textContent = "Escribe al menos un par.");
  if (!(p.desde < p.hasta)) return (estado.textContent = "La fecha de inicio tiene que ser anterior a la de fin.");
  boton.disabled = true;
  try {
    const tf = Motor.TF_MS[p.tf], desde = +new Date(p.desde), hasta = +new Date(p.hasta) + DAY;
    const calent = Math.max(600, p.tendencia * 3, p.lenta * 3) * tf;  // velas previas para que las EMAs estén asentadas
    const data = {};
    for (const x of p.pares) data[x] = await velas(x, p.tf, desde - calent, hasta, (m) => (estado.textContent = `Descargando ${m}`));
    if (p.regimen && !data[p.parRegimen]) {
      data[p.parRegimen] = await velas(p.parRegimen, p.tf, desde - Math.max(calent, p.regLenta * 2 * DAY), hasta,
        (m) => (estado.textContent = `Descargando ${m}`));
    }
    const vacios = p.pares.filter((x) => !data[x].length);
    estado.textContent = "Calculando…";
    await sleep(20);
    const res = Motor.run(data, { ...p, hasta: new Date(hasta).toISOString() });
    ultimo = { res, params: p, velas: data };
    mostrar(res, p);
    estado.textContent = `Hecho: ${res.operaciones.length} operaciones.` + (vacios.length ? ` Sin datos en OKX: ${vacios.join(", ")}.` : "");
  } catch (err) {
    estado.textContent = `No se pudo completar: ${err.message}. Revisa el nombre del par (p. ej. BTC o BTC-USDT-SWAP) y vuelve a intentarlo.`;
  } finally { boton.disabled = false; }
}

/* ---------- Resultados ---------- */
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function grafico(id, cfg) {
  if (charts[id]) charts[id].destroy();
  const tinta = css("--muted"), rejilla = css("--grid");
  Chart.defaults.font.family = css("--f-mono") || "monospace";
  Chart.defaults.color = tinta;
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false }, plugins: { legend: { display: false } } }, cfg.options);
  for (const ax of Object.values(cfg.options.scales || {})) {
    ax.grid = { color: rejilla, ...(ax.grid || {}) };
    ax.border = { color: css("--axis") };
  }
  charts[id] = new Chart($(`#${id}`), cfg);
}
const ejeTiempo = (min, max) => ({ type: "linear", min, max, ticks: { maxTicksLimit: 7, callback: (v) => fecha(v).slice(0, 7) } });
const tipFecha = { callbacks: { title: (it) => fecha(it[0].parsed.x) } };

function mostrar(res, p) {
  const m = Analisis.metricas(res, p.desde);
  $("#resultados").hidden = false;
  $("#tituloRes").textContent = `${p.nombre} · ${p.pares.join(", ")} · ${p.tf} · ${p.desde} → ${p.hasta}`;
  const kpi = [
    ["Saldo final", `${fmt(m.final)} USDT`, `desde ${fmt(m.capital, 0)}`],
    ["Rentabilidad", pct(m.rentabilidad, 0), `CAGR ${pct(m.cagr)}`],
    ["Caída máxima", pct(m.ddMax), `${fmt(m.ddAbs)} USDT`],
    ["Profit factor", fmt(m.pf), `recuperación ${fmt(m.recuperacion)}`],
    ["Operaciones", fmt(m.n, 0), `acierto ${pct(m.acierto)}`],
    ["Sharpe / Sortino", `${fmt(m.sharpe)} / ${fmt(m.sortino)}`, "anualizados, días naturales"],
  ];
  $("#kpis").innerHTML = kpi.map(([a, b, c]) => `<div class="kpi"><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join("");
  const filas = [
    ["Beneficio neto", `${fmt(m.neto)} USDT`], ["Esperanza por operación", `${fmt(m.esperanza)} USDT`],
    ["R medio por operación", fmt(m.rMedio, 3)], ["Ganancia media", `${fmt(m.medGan)} USDT`],
    ["Pérdida media", `${fmt(m.medPer)} USDT`], ["Mejor operación", `${fmt(m.mejor)} USDT`],
    ["Peor operación", `${fmt(m.peor)} USDT`], ["Racha ganadora máx.", m.rachaG], ["Racha perdedora máx.", m.rachaP],
    ["Duración media", `${fmt(m.duracionMedia / 36e5, 1)} h`],
    ["Largos", `${m.largos.n} · acierto ${pct(m.largos.acierto)} · ${fmt(m.largos.pnl)} USDT`],
    ["Cortos", `${m.cortos.n} · acierto ${pct(m.cortos.acierto)} · ${fmt(m.cortos.pnl)} USDT`],
  ];
  $("#detalle").innerHTML = filas.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("");

  const x0 = m.curva[0].t, x1 = m.curva[m.curva.length - 1].t, azul = css("--s1"), rojo = css("--neg");
  grafico("gEquity", { type: "line", data: { datasets: [{ data: m.curva.map((c) => ({ x: c.t, y: c.eq })), borderColor: azul,
    borderWidth: 2, pointRadius: 0, stepped: true, fill: { target: { value: m.capital }, above: css("--s1-fill"), below: css("--neg-fill") } }] },
    options: { scales: { x: ejeTiempo(x0, x1), y: { ticks: { callback: (v) => fmt(v, 0) } } },
      plugins: { legend: { display: false }, tooltip: { ...tipFecha, callbacks: { ...tipFecha.callbacks, label: (i) => `Saldo ${fmt(i.parsed.y)} USDT` } } } } });
  grafico("gDD", { type: "line", data: { datasets: [{ data: m.curva.map((c) => ({ x: c.t, y: c.dd * 100 })), borderColor: rojo,
    borderWidth: 2, pointRadius: 0, stepped: true, fill: { target: "origin", below: css("--neg-fill") } }] },
    options: { scales: { x: ejeTiempo(x0, x1), y: { max: 0, ticks: { callback: (v) => `${v}%` } } },
      plugins: { legend: { display: false }, tooltip: { ...tipFecha, callbacks: { ...tipFecha.callbacks, label: (i) => `Caída ${fmt(i.parsed.y, 1)}%` } } } } });

  const ops = res.operaciones;
  grafico("gOps", { type: "bar", data: { labels: ops.map((_, i) => i + 1), datasets: [{ data: ops.map((o) => o.pnl),
    backgroundColor: ops.map((o) => (o.pnl > 0 ? azul : rojo)), barPercentage: 1, categoryPercentage: 0.9 }] },
    options: { scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { ticks: { callback: (v) => fmt(v, 0) } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: (i) => { const o = ops[i[0].dataIndex]; return `#${i[0].dataIndex + 1} ${o.pair} ${o.side === 1 ? "largo" : "corto"} · ${fecha(o.closeTime)}`; },
        label: (i) => `${fmt(i.parsed.y)} USDT (${fmt(ops[i.dataIndex].pnl / ops[i.dataIndex].risk)} R)` } } } } });

  const bins = [-1.5, -1, -0.5, 0, 0.5, 1, 2, 3, 5, 10, Infinity], etiquetas = ["< −1", "−1 a −0,5", "−0,5 a 0", "0 a 0,5", "0,5 a 1", "1 a 2", "2 a 3", "3 a 5", "5 a 10", "> 10"];
  const cuenta = new Array(etiquetas.length).fill(0);
  ops.forEach((o) => { const r = o.pnl / o.risk; let i = bins.findIndex((b, k) => k > 0 && r < b); cuenta[Math.max(0, i - 1)]++; });
  grafico("gDist", { type: "bar", data: { labels: etiquetas, datasets: [{ data: cuenta, backgroundColor: etiquetas.map((_, i) => (i < 3 ? rojo : azul)) }] },
    options: { scales: { x: { title: { display: true, text: "Resultado en R" } }, y: { ticks: { precision: 0 } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => `${i.parsed.y} operaciones` } } } } });

  const agrupa = (clave, orden) => { const g = {}; ops.forEach((o) => { const k = clave(o); g[k] = (g[k] || 0) + o.pnl; }); return orden.map((k) => [k, g[k] || 0]); };
  const barras = (id, datos, horizontal) => grafico(id, { type: "bar", data: { labels: datos.map((d) => d[0]),
    datasets: [{ data: datos.map((d) => d[1]), backgroundColor: datos.map((d) => (d[1] >= 0 ? azul : rojo)) }] },
    options: { indexAxis: horizontal ? "y" : "x", scales: { x: {}, y: {} },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i) => `${fmt(horizontal ? i.parsed.x : i.parsed.y)} USDT` } } } } });
  barras("gPar", agrupa((o) => o.pair, [...new Set(ops.map((o) => o.pair))]).sort((a, b) => b[1] - a[1]), true);
  barras("gHora", agrupa((o) => `${new Date(o.openTime).getUTCHours()}h`, [...Array(24).keys()].map((h) => `${h}h`)));
  const dias = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
  barras("gDia", agrupa((o) => dias[(new Date(o.openTime).getUTCDay() + 6) % 7], dias));

  const mes = Analisis.mensual(res), meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  let h = `<thead><tr><th>Año</th>${meses.map((x) => `<th>${x}</th>`).join("")}<th>Año</th></tr></thead><tbody>`;
  for (const y of Object.keys(mes).sort()) {
    let tot = 1;
    h += `<tr><th>${y}</th>`;
    for (let k = 0; k < 12; k++) {
      const v = mes[y][k];
      if (v === undefined) { h += "<td></td>"; continue; }
      tot *= 1 + v;
      const a = Math.min(1, Math.abs(v) / 0.15);
      h += `<td style="--a:${(a * 70).toFixed(0)}%" class="${v >= 0 ? "pos" : "neg"}">${fmt(v * 100, 1)}</td>`;
    }
    h += `<td class="tot">${fmt((tot - 1) * 100, 1)}%</td></tr>`;
  }
  $("#mensual").innerHTML = h + "</tbody>";

  $("#tablaOps").innerHTML = `<thead><tr><th>#</th><th>Par</th><th>Lado</th><th>Apertura</th><th>Cierre</th><th>Entrada</th><th>Salida</th><th>USDT</th><th>R</th><th>Motivo</th></tr></thead><tbody>` +
    ops.map((o, i) => `<tr><td>${i + 1}</td><td>${o.pair}</td><td>${o.side === 1 ? "largo" : "corto"}</td><td>${fechaHora(o.openTime)}</td><td>${fechaHora(o.closeTime)}</td>
      <td>${o.entry.toPrecision(6)}</td><td>${o.exit.toPrecision(6)}</td><td class="${o.pnl > 0 ? "txt-pos" : "txt-neg"}">${fmt(o.pnl)}</td><td>${fmt(o.pnl / o.risk)}</td><td>${o.reason}</td></tr>`).join("") + "</tbody>";
  simular();
}

function simular() {
  if (!ultimo) return;
  const c = { tamano: +$("#fTam").value, riesgo: +$("#fRiesgo").value / 100, objetivo1: +$("#fObj1").value / 100,
    objetivo2: +$("#fObj2").value / 100, ddMax: +$("#fDD").value / 100, ddDiario: +$("#fDDd").value / 100, reparto: +$("#fRep").value / 100 };
  const f = Analisis.fondeos(ultimo.res, c);
  $("#fResumen").innerHTML = [
    ["Retos empezados", f.retos], ["Llegaron a fondeada", f.fondeadas], ["Suspendidos", f.suspendidos],
    ["Fondeadas perdidas", f.perdidas], ["Cobrado en total", `${fmt(f.cobrado, 0)} $`],
    ["Días medios hasta fondear", f.diasHastaFondeo === null ? "—" : fmt(f.diasHastaFondeo, 0)],
  ].map(([a, b]) => `<div class="kpi"><span>${a}</span><b>${b}</b></div>`).join("");
  $("#fTabla").innerHTML = "<thead><tr><th>#</th><th>Inicio</th><th>Fin</th><th>Operaciones</th><th>Resultado</th><th>Cobrado</th></tr></thead><tbody>" +
    f.intentos.map((i, k) => `<tr><td>${k + 1}</td><td>${fecha(i.inicio)}</td><td>${i.fin ? fecha(i.fin) : "—"}</td><td>${i.ops}</td><td>${i.resultado}</td><td>${fmt(i.cobrado, 0)} $</td></tr>`).join("") + "</tbody>";
}

/* ---------- Exportar ---------- */
function bajarArchivo(nombre, texto) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([texto], { type: "text/csv" }));
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportarOps() {
  if (!ultimo) return;
  bajarArchivo("operaciones.csv", "par,lado,apertura,cierre,entrada,salida,pnl,riesgo,motivo\n" + ultimo.res.operaciones.map((o) =>
    [o.pair, o.side === 1 ? "largo" : "corto", new Date(o.openTime).toISOString(), new Date(o.closeTime).toISOString(), o.entry, o.exit, o.pnl.toFixed(4), o.risk.toFixed(4), o.reason].join(",")).join("\n"));
}
function exportarVelas() {
  if (!ultimo?.velas) return ($("#estado").textContent = "Primero lanza un backtest para descargar las velas.");
  for (const [par, v] of Object.entries(ultimo.velas))
    bajarArchivo(`${instId(par)}_${ultimo.params.tf}.csv`, "fecha,open,high,low,close\n" + v.map((k) => `${new Date(k.t).toISOString()},${k.o},${k.h},${k.l},${k.c}`).join("\n"));
}

/* ---------- Arranque ---------- */
window.addEventListener("DOMContentLoaded", async () => {
  $("#preset").addEventListener("change", (e) => { if (e.target.value !== "propia") rellenar(PRESETS[e.target.value]); });
  $("#form").addEventListener("input", (e) => { if (e.target.id !== "preset" && !["desde", "hasta"].includes(e.target.id)) $("#preset").value = "propia"; activar(); });
  $("#form").addEventListener("submit", lanzar);
  $("#fondeo").addEventListener("input", simular);
  $("#expOps").addEventListener("click", exportarOps);
  $("#expVelas").addEventListener("click", exportarVelas);
  rellenar(PRESETS.definitiva);
  $("#hasta").value = fecha(Date.now());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => ultimo && mostrar(ultimo.res, ultimo.params));
  try {  // resultado guardado para que la página no abra vacía
    const ej = await (await fetch("ejemplo.json")).json();
    ultimo = { res: ej.res, params: ej.params, velas: null };
    mostrar(ej.res, ej.params);
    $("#estado").textContent = `Mostrando un resultado guardado: ${ej.params.nombre} (${ej.params.desde} → ${ej.params.hasta}). Pulsa «Descargar y lanzar» para calcular el tuyo.`;
  } catch { /* sin ejemplo: la página espera al primer backtest */ }
});
