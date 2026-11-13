"""Índice de valoración de BTC (0-100; 100 = zona de suelo/barato, 0 = zona de techo/caro).

Seis componentes de 0 a 10 (F, R, E, L, D, I); total = media x 10. Fórmulas en indice.html y en PROMPT.md.
Escribe data/indice.json. Si una fuente falla reutiliza su último valor guardado; si falla todo, no escribe nada.
Uso: python indice/calcular.py
"""
import io
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parent.parent / "data" / "indice.json"
UA = {"User-Agent": "banco-backtests/1.0"}
DESDE = pd.Timestamp("2021-01-01")


def get(url, intentos=4):
    for i in range(intentos):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read().decode()
        except Exception:
            if i == intentos - 1:
                raise
            time.sleep(5 * (i + 1))


def fred(sid):
    clave = os.environ.get("FRED_API_KEY", "").strip()
    if clave:  # API oficial: la descarga CSV de la web de FRED bloquea los servidores de GitHub
        q = urllib.parse.urlencode({"series_id": sid, "api_key": clave, "file_type": "json", "observation_start": "2018-01-01"})
        obs = json.loads(get(f"https://api.stlouisfed.org/fred/series/observations?{q}"))["observations"]
        s = pd.Series({pd.Timestamp(o["date"]): o["value"] for o in obs})
    else:
        s = pd.read_csv(io.StringIO(get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=2018-01-01")),
                        index_col=0, parse_dates=True).iloc[:, 0]
    return pd.to_numeric(s, errors="coerce").dropna()


def btc_diario():
    """Velas diarias UTC de BTC-USDT al contado (OKX), solo cerradas."""
    filas, after = [], ""
    while True:
        j = json.loads(get(f"https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT&bar=1Dutc&limit=100{after}"))
        if not j["data"]:
            break
        filas += [r for r in j["data"] if r[8] == "1"]
        after = f"&after={j['data'][-1][0]}"
        if int(j["data"][-1][0]) < pd.Timestamp("2019-01-01").value // 10**6:
            break
        time.sleep(0.15)
    s = pd.Series({pd.Timestamp(int(r[0]), unit="ms"): float(r[4]) for r in filas}).sort_index()
    return s[~s.index.duplicated()]


def ema(x, n):  # como TA-Lib: arranca con la media simple
    out = np.full(len(x), np.nan)
    if len(x) >= n:
        out[n - 1] = x[:n].mean()
        for i in range(n, len(x)):
            out[i] = out[i - 1] + 2 / (n + 1) * (x[i] - out[i - 1])
    return out


def rsi(c, n=14):  # Wilder
    d = np.diff(c, prepend=np.nan)
    up, dn = np.clip(d, 0, None), np.clip(-d, 0, None)
    au, ad = pd.Series(up).ewm(alpha=1 / n, adjust=False).mean(), pd.Series(dn).ewm(alpha=1 / n, adjust=False).mean()
    return (100 - 100 / (1 + au / ad)).to_numpy()


def pct_rank(s, ventana):
    """Percentil (0-100) del valor de cada día dentro de la ventana anterior, incluido él mismo."""
    return s.rolling(ventana, min_periods=ventana // 2).apply(lambda w: (w <= w[-1]).mean() * 100, raw=True)


def punt(x):
    return np.clip(np.floor(x + 1e-9), 0, 10)  # hacia abajo, como el índice de referencia (EMA -2,6 % -> 5,5 -> 5)


# ---------- componentes: cada uno devuelve (serie diaria de puntos, serie diaria del dato bruto, detalle actual) ----------
def comp_F(dias):
    j = json.loads(get("https://api.alternative.me/fng/?limit=0&format=json"))
    fg = pd.Series({pd.Timestamp(int(d["timestamp"]), unit="s").normalize(): int(d["value"]) for d in j["data"]}).sort_index()
    m7 = fg.rolling(7).mean()
    # miedo = barato: 10 con media <= 15, 0 con media >= 65. Ajustado a tres lecturas del índice de referencia (4, 5 y
    # 10-nov-2026): (34 + 34,6)/2 -> 6, (50 + 34,4)/2 -> 4, (32 + 32,3)/2 -> 6
    pts = punt((65 - (fg + m7) / 2) / 5)
    return pts.reindex(dias).ffill(), f"MyC actual {fg.iloc[-1]} | media 7 d {m7.iloc[-1]:.1f}"


def comp_RE(precio):
    c = precio.to_numpy()
    r = pd.Series(rsi(c), index=precio.index)
    e = pd.Series(ema(c, 200), index=precio.index)
    dist = (precio / e - 1) * 100
    # RSI 25 -> 10, 85 -> 0 (referencia: 35,6 -> 8, 50,9 -> 5, 35,9 -> 8, 25,6 -> 9); EMA: -40 % -> 10, +40 % -> 0
    # (referencia: -0,1 % -> 5, +5,1 % -> 4, -2,6 % -> 5, -9,7 % -> 6). Ajuste del 13-nov-2026 con 4 lecturas de cada una
    return (punt((85 - r) / 6), f"RSI 14 d {r.iloc[-1]:.1f}",
            punt(5 - dist / 8), f"EMA 200 d {e.iloc[-1]:,.0f} ({dist.iloc[-1]:+.1f}%)".replace(",", "."))


def m2_eurozona():
    """M2 de la zona euro en EUR, mensual, del BCE (al día); si falla, la serie de la OCDE en FRED (parada en 2023)."""
    try:
        d = pd.read_csv(io.StringIO(get("https://data-api.ecb.europa.eu/service/data/BSI/M.U2.Y.V.M20.X.1.U2.2300.Z01.E"
                                        "?format=csvdata&startPeriod=2017-01")))
        return pd.Series(d.OBS_VALUE.to_numpy(float) * 10.0 ** d.UNIT_MULT.to_numpy(float),
                         index=pd.to_datetime(d.TIME_PERIOD)).sort_index(), "BCE"
    except Exception:
        return fred("MABMM301EZM189S"), "OCDE"


def comp_L(dias):
    # Liquidez global = masa monetaria M2 de EE. UU. + zona euro + Japón + China + Reino Unido, en dólares al tipo de
    # cambio de cada día (por eso se mueve a diario con el dólar). Percentil del cambio a 91 días dentro del último año.
    # Con esta medida salen las tres lecturas del índice de referencia (4, 5 y 10-nov-2026: L 8, 8, 9).
    # shortcut: el M2 de Japón, China y Reino Unido de la OCDE dejó de publicarse (2023; China 2018) y se usa su último
    # valor convertido con el tipo de cambio del día; si se encuentra una fuente gratuita al día, cambiarla aquí.
    dia = pd.date_range("2018-01-01", pd.Timestamp.today().normalize(), freq="D")
    f = lambda s: s.reindex(s.index.union(dia)).ffill().reindex(dia)  # noqa: E731
    ez, fuente_ez = m2_eurozona()
    liq = (f(fred("M2SL")) * 1e9 + f(ez) * f(fred("DEXUSEU")) + f(fred("MABMM301JPM189S")) / f(fred("DEXJPUS"))
           + f(fred("MABMM301CNM189S")) / f(fred("DEXCHUS")) + f(fred("MABMM301GBM189S")) * f(fred("DEXUSUK"))).dropna()
    var = liq / liq.shift(91) - 1
    p = pct_rank(var.dropna(), 365)
    pts = punt(10 - p / 10)
    det = (f"M2 global {liq.iloc[-1] / 1e12:.1f} billones $ | var 91 d {var.iloc[-1] * 100:+.1f}% | "
           f"P{p.iloc[-1]:.0f} del último año (zona euro: {fuente_ez})")
    return pts.reindex(pts.index.union(dias)).ffill().reindex(dias), det


def comp_D(dias):
    try:
        j = json.loads(get("https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=10y&interval=1d"))["chart"]["result"][0]
        dxy = pd.Series(j["indicators"]["quote"][0]["close"], index=pd.to_datetime(j["timestamp"], unit="s").normalize()).dropna()
        fuente = "DXY (Yahoo)"
    except Exception:
        dxy, fuente = fred("DTWEXBGS"), "dólar amplio (FRED)"
    dxy = dxy[~dxy.index.duplicated(keep="last")]
    # nota = 8,5 + variación del DXY en 1 mes (%): la única que cuadra con las 4 lecturas del índice de referencia
    # (1 mes -0,56 % -> 7, -0,42 % -> 8, -0,2 % -> 8, +0,65 % -> 9; 13-nov-2026). Dólar que sube = presión sobre BTC =
    # BTC más barato = más puntos (cuanto más alto el índice, más barato). La media de 200 días ya no cuadraba
    hace_1m = dxy.asof(dxy.index - pd.Timedelta(days=30))
    var_1m = pd.Series(dxy.to_numpy() / hace_1m.to_numpy() - 1, index=dxy.index) * 100
    pts = punt(8.5 + var_1m)
    dist = (dxy / dxy.rolling(200).mean() - 1) * 100
    m1 = var_1m.iloc[-1] / 100
    det = f"{fuente} {dxy.iloc[-1]:.2f} | 1 mes {m1 * 100:+.2f}% | {dist.iloc[-1]:+.2f}% sobre su media de 200 d"
    return pts.reindex(pts.index.union(dias)).ffill().reindex(dias), det


def comp_I(dias):
    try:
        from pytrends.request import TrendReq
        tr = TrendReq(hl="es-ES", tz=0, timeout=(10, 30))
        tr.build_payload(["bitcoin"], timeframe="all")  # escala 0-100 sobre todo el historial (máximo: dic 2017)
        v = tr.interest_over_time()["bitcoin"].astype(float)
        fuente = "Google Trends"
    except Exception:
        # Respaldo: visitas diarias al artículo "Bitcoin" de Wikipedia (media 7 días), escaladas a su máximo histórico.
        fin = pd.Timestamp.today().strftime("%Y%m%d")
        j = json.loads(get("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/"
                           f"Bitcoin/daily/20160101/{fin}"))
        w = pd.Series({pd.Timestamp(d["timestamp"][:8]): d["views"] for d in j["items"]}).rolling(7).mean()
        v = (w / w.cummax() * 100).dropna()
        fuente = "visitas a Wikipedia (respaldo de Google Trends)"
    pts = punt(10 - v / 10)
    return pts.reindex(pts.index.union(dias)).ffill().reindex(dias), f"{fuente}: {v.iloc[-1]:.0f}/100"


NOMBRES = {"F": "Miedo y codicia", "R": "RSI diario", "E": "EMA 200 diaria", "L": "Liquidez global", "D": "Dólar (DXY)",
           "I": "Interés (búsquedas)"}


def zona(t):
    return ("Zona de techo" if t < 25 else "Caro" if t < 40 else "Zona neutral" if t < 65 else "Barato" if t < 80
            else "Zona de suelo")


def main():
    previo = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None
    precio = btc_diario()
    dias = precio.index[precio.index >= DESDE]
    comps, detalles, fallos = {}, {}, []
    R, dR, E, dE = comp_RE(precio)
    comps["R"], detalles["R"], comps["E"], detalles["E"] = R.reindex(dias), dR, E.reindex(dias), dE
    for letra, fn in (("F", comp_F), ("L", comp_L), ("D", comp_D), ("I", comp_I)):
        try:
            comps[letra], detalles[letra] = fn(dias)
        except Exception as e:  # fuente caída: se reutiliza lo último guardado
            fallos.append(f"{letra}: {e!r}"[:200])
            if previo:
                h = {r[0]: r[3 + "FRELDI".index(letra)] for r in previo["historia"]}
                comps[letra] = pd.Series([h.get(d.strftime("%Y-%m-%d")) for d in dias], index=dias, dtype=float).ffill()
                det = next(c["detalle"] for c in previo["actual"]["componentes"] if c["letra"] == letra)
                detalles[letra] = det if det.endswith("(sin actualizar)") else det + " (sin actualizar)"
            else:
                comps[letra] = pd.Series(np.nan, index=dias)
                detalles[letra] = "sin datos"
    df = pd.DataFrame(comps)[list("FRELDI")]
    df["total"] = (df.mean(axis=1, skipna=False) * 10).round()
    df["precio"] = precio.reindex(dias)
    df = df.dropna()
    if df.empty:
        raise SystemExit("Sin datos suficientes: no se sobrescribe el JSON. " + "; ".join(fallos))
    ult = df.iloc[-1]
    out = {
        "actualizado": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d %H:%M UTC"), "fecha": df.index[-1].strftime("%Y-%m-%d"),
        "actual": {"total": int(ult.total), "zona": zona(ult.total), "precio": round(float(ult.precio), 2),
                   "componentes": [{"letra": k, "nombre": NOMBRES[k], "puntos": int(ult[k]), "detalle": detalles[k]} for k in "FRELDI"]},
        "historia": [[d.strftime("%Y-%m-%d"), int(r.total), round(float(r.precio), 2), *[int(r[k]) for k in "FRELDI"]]
                     for d, r in df.iterrows()],
        "fallos": fallos,
    }
    assert 0 <= out["actual"]["total"] <= 100 and len(out["historia"]) > 1000
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"{out['fecha']}: {out['actual']['total']}/100 ({out['actual']['zona']})")
    for c in out["actual"]["componentes"]:
        print(f"  {c['letra']} {c['nombre']}: {c['puntos']}/10 · {c['detalle']}")
    print("fallos:", fallos or "ninguno")


if __name__ == "__main__":
    main()
