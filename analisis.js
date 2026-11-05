/* Métricas y simulador de fondeos a partir de las operaciones cerradas. Sin dependencias (sirve en Node). */
(function (root) {
  "use strict";
  const DAY = 864e5;

  function metricas(res, desde) {
    const ops = res.operaciones, cap = res.capital;
    const pnl = ops.map((o) => o.pnl), R = ops.map((o) => o.pnl / o.risk);
    const gan = pnl.filter((x) => x > 0), per = pnl.filter((x) => x <= 0);
    const gp = gan.reduce((a, b) => a + b, 0), gl = -per.reduce((a, b) => a + b, 0);
    let eq = cap, pico = cap, ddMax = 0, ddAbs = 0, rachaG = 0, rachaP = 0, g = 0, p = 0;
    const curva = [{ t: +new Date(desde), eq: cap, dd: 0 }];
    for (const o of ops) {
      eq += o.pnl;
      pico = Math.max(pico, eq);
      const dd = eq / pico - 1;
      if (dd < ddMax) { ddMax = dd; ddAbs = pico - eq; }
      curva.push({ t: o.closeTime, eq, dd });
      if (o.pnl > 0) { g++; p = 0; } else { p++; g = 0; }
      rachaG = Math.max(rachaG, g); rachaP = Math.max(rachaP, p);
    }
    // Rentabilidades diarias (días naturales: cripto opera 7/7) para Sharpe y Sortino.
    const t0 = Math.floor(+new Date(desde) / DAY), t1 = ops.length ? Math.floor(ops[ops.length - 1].closeTime / DAY) : t0;
    const porDia = new Map();
    for (const o of ops) { const d = Math.floor(o.closeTime / DAY); porDia.set(d, (porDia.get(d) || 0) + o.pnl); }
    const rets = [];
    let b = cap;
    for (let d = t0; d <= t1; d++) { const x = porDia.get(d) || 0; rets.push(x / b); b += x; }
    const media = rets.reduce((a, c) => a + c, 0) / (rets.length || 1);
    const sd = Math.sqrt(rets.reduce((a, c) => a + (c - media) ** 2, 0) / Math.max(1, rets.length - 1));
    const sdNeg = Math.sqrt(rets.reduce((a, c) => a + Math.min(0, c) ** 2, 0) / Math.max(1, rets.length - 1));
    const dias = Math.max(1, t1 - t0), fin = res.saldo, neto = fin - cap;
    const lado = (s) => {
      const x = ops.filter((o) => o.side === s);
      return { n: x.length, acierto: x.length ? x.filter((o) => o.pnl > 0).length / x.length : 0, pnl: x.reduce((a, o) => a + o.pnl, 0) };
    };
    return {
      capital: cap, final: fin, neto, rentabilidad: neto / cap, n: ops.length,
      acierto: ops.length ? gan.length / ops.length : 0, pf: gl ? gp / gl : Infinity, esperanza: ops.length ? neto / ops.length : 0,
      rMedio: R.length ? R.reduce((a, c) => a + c, 0) / R.length : 0,
      medGan: gan.length ? gp / gan.length : 0, medPer: per.length ? -gl / per.length : 0,
      mejor: pnl.length ? Math.max(...pnl) : 0, peor: pnl.length ? Math.min(...pnl) : 0,
      ddMax, ddAbs, recuperacion: ddAbs ? neto / ddAbs : Infinity, rachaG, rachaP,
      sharpe: sd ? (media / sd) * Math.sqrt(365) : 0, sortino: sdNeg ? (media / sdNeg) * Math.sqrt(365) : 0,
      cagr: fin > 0 ? Math.pow(fin / cap, 365 / dias) - 1 : -1,
      duracionMedia: ops.length ? ops.reduce((a, o) => a + (o.closeTime - o.openTime), 0) / ops.length : 0,
      largos: lado(1), cortos: lado(-1), curva,
    };
  }

  // Rentabilidad de cada mes sobre el saldo al empezar el mes.
  function mensual(res) {
    const out = {};
    let b = res.capital;
    const porMes = new Map();
    for (const o of res.operaciones) {
      const d = new Date(o.closeTime), k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      if (!porMes.has(k)) porMes.set(k, { y: d.getUTCFullYear(), m: d.getUTCMonth(), ini: b, pnl: 0 });
      porMes.get(k).pnl += o.pnl;
      b += o.pnl;
    }
    for (const v of porMes.values()) (out[v.y] = out[v.y] || {})[v.m] = v.pnl / v.ini;
    return out;
  }

  /* Encadena retos de prop firm con la secuencia real de operaciones (en múltiplos de R). Fase 1 -> fase 2 (si
     objetivo2 > 0) -> fondeada. Al suspender o perder la fondeada se empieza otro reto con la siguiente operación.
     En la fondeada se cobra a fin de cada mes el beneficio por encima del tamaño, al % de reparto. */
  function fondeos(res, c) {
    const intentos = [];
    let fase = 1, bal = c.tamano, dia = null, iniDia = bal, mes = null, act = null, cobrado = 0;
    const nuevo = (t) => { act = { inicio: t, fin: null, fase: 1, resultado: "en curso", cobrado: 0, ops: 0 }; intentos.push(act); };
    for (const o of res.operaciones) {
      if (!act) nuevo(o.openTime);
      const d = Math.floor(o.closeTime / DAY), dt = new Date(o.closeTime), m = dt.getUTCFullYear() * 12 + dt.getUTCMonth();
      if (fase === "fondeada" && mes !== null && m !== mes && bal > c.tamano) {
        const x = (bal - c.tamano) * c.reparto;
        act.cobrado += x; cobrado += x; bal = c.tamano;
      }
      mes = m;
      if (d !== dia) { dia = d; iniDia = bal; }
      bal += (o.pnl / o.risk) * c.riesgo * c.tamano;
      act.ops++;
      const quiebra = bal <= c.tamano * (1 - c.ddMax) || iniDia - bal >= c.ddDiario * c.tamano;
      if (quiebra) {
        act.fin = o.closeTime;
        act.resultado = fase === "fondeada" ? "fondeada perdida" : `suspendido en fase ${fase}`;
        fase = 1; bal = c.tamano; iniDia = bal; act = null;
        continue;
      }
      if (fase === 1 && bal >= c.tamano * (1 + c.objetivo1)) {
        fase = c.objetivo2 > 0 ? 2 : "fondeada"; act.fase = fase; bal = c.tamano; iniDia = bal;
        if (fase === "fondeada") act.fondeo = o.closeTime;
      } else if (fase === 2 && bal >= c.tamano * (1 + c.objetivo2)) {
        fase = "fondeada"; act.fase = fase; act.fondeo = o.closeTime; bal = c.tamano; iniDia = bal;
      }
    }
    if (act) { act.resultado = fase === "fondeada" ? "fondeada (sigue)" : `en fase ${fase}`; }
    const fondeadas = intentos.filter((i) => i.fondeo);
    return {
      intentos, retos: intentos.length, fondeadas: fondeadas.length,
      suspendidos: intentos.filter((i) => i.resultado.startsWith("suspendido")).length,
      perdidas: intentos.filter((i) => i.resultado === "fondeada perdida").length,
      cobrado, diasHastaFondeo: fondeadas.length ? fondeadas.reduce((a, i) => a + (i.fondeo - i.inicio) / DAY, 0) / fondeadas.length : null,
    };
  }

  const api = { metricas, mensual, fondeos };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Analisis = api;
})(typeof window !== "undefined" ? window : globalThis);
