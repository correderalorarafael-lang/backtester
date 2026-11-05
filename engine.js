/* Motor de backtest: copia la lógica de bot.py / gold_bot.py (ema-bot) para poder comprobarla contra Python.
   Velas: {t (ms, apertura UTC), o, h, l, c}. Funciona en el navegador (window.Motor) y en Node (require). */
(function (root) {
  "use strict";
  const TF_MS = { "15m": 9e5, "30m": 18e5, "1H": 36e5, "2H": 72e5, "4H": 144e5, "1D": 864e5 };
  const DAY = 864e5;

  // EMA como TA-Lib: arranca con la media simple de las n primeras velas.
  function ema(x, n) {
    const o = new Array(x.length).fill(NaN);
    if (x.length < n) return o;
    let s = 0;
    for (let i = 0; i < n; i++) s += x[i];
    o[n - 1] = s / n;
    const a = 2 / (n + 1);
    for (let i = n; i < x.length; i++) o[i] = o[i - 1] + a * (x[i] - o[i - 1]);
    return o;
  }

  // ATR de Wilder como TA-Lib (primer valor en la vela n).
  function atr(h, l, c, n) {
    const N = c.length, o = new Array(N).fill(NaN);
    if (N - 1 < n) return o;
    const tr = (k) => Math.max(h[k], c[k - 1]) - Math.min(l[k], c[k - 1]);
    let s = 0;
    for (let k = 1; k <= n; k++) s += tr(k);
    o[n] = s / n;
    for (let i = n + 1; i < N; i++) o[i] = (o[i - 1] * (n - 1) + tr(i)) / n;
    return o;
  }

  const weekday = (t) => { const d = new Date(t).getUTCDay(); return d >= 1 && d <= 5; };

  // Señales por vela. Con sinFinde, los indicadores se calculan solo con velas de lunes a viernes.
  function indicators(cs, p) {
    const idx = [];
    cs.forEach((k, i) => { if (!p.sinFinde || weekday(k.t)) idx.push(i); });
    const c = idx.map((i) => cs[i].c), h = idx.map((i) => cs[i].h), l = idx.map((i) => cs[i].l);
    const f = ema(c, p.rapida), s = ema(c, p.lenta), t = ema(c, p.tendencia), a = atr(h, l, c, p.atrN);
    const N = cs.length, z = () => new Array(N).fill(false);
    const out = { long: z(), short: z(), exitL: z(), exitS: z(), stopL: new Array(N).fill(NaN), stopS: new Array(N).fill(NaN) };
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j], fp = j ? f[j - 1] : NaN, sp = j ? s[j - 1] : NaN;
      const up = f[j] > s[j] && fp <= sp, dn = f[j] < s[j] && fp >= sp;
      out.long[i] = up && c[j] > t[j];
      out.short[i] = dn && c[j] < t[j];
      out.exitL[i] = p.salidaCompleta ? dn && c[j] < t[j] : dn;
      out.exitS[i] = p.salidaCompleta ? up && c[j] > t[j] : up;
      out.stopL[i] = c[j] - p.atrMult * a[j];
      out.stopS[i] = c[j] + p.atrMult * a[j];
    }
    return out;
  }

  // Régimen: EMA rápida > lenta diarias del par de régimen, con los días ya cerrados antes del de t.
  function regimeFn(cs, p) {
    const days = [], closes = [];
    for (const k of cs) {
      const d = Math.floor(k.t / DAY) * DAY;
      if (days.length && days[days.length - 1] === d) closes[closes.length - 1] = k.c;
      else { days.push(d); closes.push(k.c); }
    }
    const f = ema(closes, p.regRapida), s = ema(closes, p.regLenta);
    return (t) => {
      const day = Math.floor(t / DAY) * DAY;
      let lo = 0, hi = days.length - 1, k = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (days[m] < day) { k = m; lo = m + 1; } else hi = m - 1; }
      return !(k >= 0 && f[k] <= s[k]);  // sin datos suficientes cuenta como alcista (igual que el bot)
    };
  }

  /* data: {par: velas}. p: parámetros (ver DEFAULTS en app.js). Devuelve {saldo, operaciones, avisos}. */
  function run(data, p) {
    const tf = TF_MS[p.tf], start = +new Date(p.desde), end = +new Date(p.hasta);
    const pairs = p.pares.filter((x) => data[x] && data[x].length);
    const cs = {}, ind = {}, pos = {};
    for (const x of pairs) {
      cs[x] = data[x].filter((k) => k.t < end);
      ind[x] = indicators(cs[x], p);
      pos[x] = new Map(cs[x].map((k, i) => [k.t, i]));
    }
    const bull = p.regimen && data[p.parRegimen] ? regimeFn(data[p.parRegimen].filter((k) => k.t < end), p) : () => true;
    const st = { balance: p.capital, open: [], closed: [], seen: {} };
    const times = [...new Set(pairs.flatMap((x) => cs[x].filter((k) => k.t >= start).map((k) => k.t)))].sort((a, b) => a - b);
    const lastIdx = (x, t) => {  // última vela de x con apertura <= t
      const a = cs[x]; let lo = 0, hi = a.length - 1, r = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; }
      return r;
    };
    const close = (tr, price, when, reason, fee) => {
      const pnl = tr.side * (price - tr.entry) * tr.qty - tr.entry * tr.qty * p.maker - price * tr.qty * fee;
      st.balance += pnl;
      st.open.splice(st.open.indexOf(tr), 1);
      st.closed.push({ ...tr, exit: price, closeTime: when, pnl, reason });
    };

    for (const t of times) {
      // 1) Stops y salidas de las abiertas, vela a vela desde la última revisión.
      for (const tr of [...st.open]) {
        const a = cs[tr.pair], I = ind[tr.pair], upto = lastIdx(tr.pair, t);
        for (let i = tr.checkedIdx + 1; i <= upto; i++) {
          const k = a[i];
          if (tr.side === 1 ? k.l <= tr.stop : k.h >= tr.stop) {
            close(tr, tr.side === 1 ? Math.min(k.o, tr.stop) : Math.max(k.o, tr.stop), k.t, "stop", p.taker);
            break;
          }
          if (tr.side === 1 ? I.exitL[i] : I.exitS[i]) { close(tr, k.c, k.t + tf, "cruce contrario", p.maker); break; }
          tr.checkedIdx = i;
        }
      }
      // 2) Entradas con la señal de la vela que acaba de cerrar.
      const frames = pairs.filter((x) => pos[x].has(t));
      for (const tr of st.open) if (!frames.includes(tr.pair)) frames.push(tr.pair);
      let okMap = null;
      if (p.fuerza) {  // ranking de la subida de las últimas N velas entre los pares con datos
        const ret = [];
        for (const x of frames) {
          const i = lastIdx(x, t);
          if (i + 1 > p.fuerzaVelas) ret.push([x, cs[x][i].c / cs[x][i - p.fuerzaVelas].c - 1]);
        }
        okMap = {};
        if (ret.length > p.fuerzaExcluir) {
          const asc = [...ret].sort((a, b) => a[1] - b[1]).map((r) => r[0]);
          ret.forEach(([x]) => {
            const r = asc.indexOf(x);
            okMap[x] = [r >= p.fuerzaExcluir, r < ret.length - p.fuerzaExcluir];
          });
        }
      }
      for (const x of frames) {
        if (!pairs.includes(x)) continue;
        const i = lastIdx(x, t), k = cs[x][i];
        if (k.t <= (st.seen[x] ?? -Infinity)) continue;
        st.seen[x] = k.t;
        const [okL, okS] = okMap ? (okMap[x] || [false, false]) : [true, true];
        const L = ind[x].long[i] && okL && p.direccion !== "cortos", S = ind[x].short[i] && okS && p.direccion !== "largos";
        const side = L ? 1 : S ? -1 : 0;
        if (!side || st.open.some((o) => o.pair === x)) continue;
        if (p.regimen) {
          const slots = bull(k.t) ? p.huecosAlcista : p.huecosBajista;
          if (st.open.filter((o) => o.side === side).length >= slots[side === 1 ? 0 : 1]) continue;
        } else if (st.open.length >= p.maxAbiertas) continue;
        const entry = k.c, stop = side === 1 ? ind[x].stopL[i] : ind[x].stopS[i], dist = Math.abs(entry - stop) / entry;
        if (!(dist > 0)) continue;
        const opened = k.t + tf, bal = st.balance, day = Math.floor(opened / DAY);
        const today = st.closed.filter((c) => Math.floor(c.closeTime / DAY) === day);
        const pnlToday = today.reduce((s, c) => s + c.pnl, 0);
        const losses = -today.reduce((s, c) => s + Math.min(0, c.pnl), 0);
        if (losses + st.open.reduce((s, o) => s + o.risk, 0) + p.riesgo * bal > p.perdidaDiaria * (bal - pnlToday) + 1e-9) continue;
        const notional = (p.riesgo * bal) / (dist + p.maker + p.taker);
        st.open.push({ pair: x, side, entry, stop, qty: notional / entry, risk: p.riesgo * bal,
                       lev: Math.max(1, Math.min(p.maxApal, Math.floor(0.5 / dist))), openTime: opened, checkedIdx: i });
      }
    }
    for (const tr of [...st.open]) { const a = cs[tr.pair], k = a[a.length - 1]; close(tr, k.c, k.t, "fin", p.maker); }
    st.closed.sort((a, b) => a.closeTime - b.closeTime);
    return { saldo: st.balance, capital: p.capital, operaciones: st.closed.map(({ checkedIdx, ...o }) => o) };
  }

  const api = { TF_MS, ema, atr, indicators, run };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Motor = api;
})(typeof window !== "undefined" ? window : globalThis);
