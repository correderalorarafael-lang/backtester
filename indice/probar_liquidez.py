"""Prueba (solo lectura): ¿la liquidez del índice de referencia es la masa monetaria M2 global en dólares?
Objetivo: sus percentiles 4-nov P19, 5-nov P17, 10-nov P7 (sus capturas de madrugada usan datos hasta el día anterior)."""
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from calcular import fred, pct_rank  # noqa: E402

def prueba(sid):
    try:
        s = fred(sid)
        print(f"  {sid:20s} último dato {s.index[-1].date()}  valor {s.iloc[-1]:,.1f}", flush=True)
        return s
    except Exception as e:
        print(f"  {sid:20s} NO DISPONIBLE ({e!r:.80})", flush=True)
        return None

print("Series M2 y tipos de cambio en FRED:")
S = {k: prueba(k) for k in ["M2SL", "MABMM301EZM189S", "MABMM301JPM189S", "MABMM301CNM189S", "MABMM301GBM189S",
                            "MYAGM2EZM196N", "MYAGM2JPM189S", "MYAGM2CNM189N",
                            "DEXUSEU", "DEXJPUS", "DEXCHUS", "DEXUSUK", "WALCL", "WTREGEN", "RRPONTSYD", "ECBASSETSW", "JPNASSETS"]}
dia = pd.date_range("2019-01-01", pd.Timestamp.today().normalize(), freq="D")
f = lambda s: s.reindex(s.index.union(dia)).ffill().reindex(dia)  # noqa: E731
partes = {"EE. UU.": f(S["M2SL"]) * 1e9}  # M2SL en miles de millones de USD
if S["MABMM301EZM189S"] is not None:
    partes["Eurozona"] = f(S["MABMM301EZM189S"]) * f(S["DEXUSEU"])  # EUR -> USD
if S["MABMM301JPM189S"] is not None:
    partes["Japón"] = f(S["MABMM301JPM189S"]) / f(S["DEXJPUS"])  # JPY -> USD
if S["MABMM301CNM189S"] is not None:
    partes["China"] = f(S["MABMM301CNM189S"]) / f(S["DEXCHUS"])  # CNY -> USD
if S["MABMM301GBM189S"] is not None:
    partes["Reino Unido"] = f(S["MABMM301GBM189S"]) * f(S["DEXUSUK"])
objetivo = {"2026-11-03": 19, "2026-11-04": 17, "2026-11-09": 7}
combos = {"M2 EE. UU.": ["EE. UU."], "M2 EE. UU. + Eurozona": ["EE. UU.", "Eurozona"],
          "M2 EE. UU. + Eur + Japón": ["EE. UU.", "Eurozona", "Japón"],
          "M2 EE. UU. + Eur + Japón + China": ["EE. UU.", "Eurozona", "Japón", "China"],
          "M2 todos los disponibles": list(partes)}
for nombre, ks in combos.items():
    if not all(k in partes for k in ks):
        print(f"{nombre:34s} (faltan series)"); continue
    liq = sum(partes[k] for k in ks).dropna()
    for etiqueta, n, v in (("91 d en 365", 91, 365), ("63 d en 252", 63, 252), ("30 d en 365", 30, 365)):
        p = pct_rank((liq / liq.shift(n) - 1).dropna(), v)
        res = [round(float(p[p.index <= d].iloc[-1])) for d in objetivo]
        print(f"{nombre:34s} {etiqueta:12s} -> {res}  referencia {list(objetivo.values())}", flush=True)
