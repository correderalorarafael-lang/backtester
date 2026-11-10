"""Prueba (solo lectura): qué medida de liquidez da los percentiles del índice de referencia (4-nov P19, 5-nov P17,
10-nov P7; sus capturas de madrugada usan los datos hasta el día anterior). Se lanza a mano desde GitHub."""
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from calcular import fred, pct_rank  # noqa: E402

walcl, tga, rrp = fred("WALCL"), fred("WTREGEN"), fred("RRPONTSYD")
ecb, eur, boj, jpy = fred("ECBASSETSW"), fred("DEXUSEU"), fred("JPNASSETS"), fred("DEXJPUS")
sem = pd.date_range("2018-06-06", pd.Timestamp.today(), freq="W-WED")
dia = pd.date_range("2018-06-06", pd.Timestamp.today(), freq="D")
f = lambda s, idx: s.reindex(s.index.union(idx)).ffill().reindex(idx)  # noqa: E731
medidas = {
    "global semanal (la nuestra)": f(walcl, sem) - f(tga, sem) - f(rrp, sem) * 1000 + f(ecb, sem) * f(eur, sem) + f(boj, sem) * 100 / f(jpy, sem),
    "EE. UU. neta semanal": f(walcl, sem) - f(tga, sem) - f(rrp, sem) * 1000,
    "EE. UU. neta diaria": f(walcl, dia) - f(tga, dia) - f(rrp, dia) * 1000,
    "solo balance Fed semanal": f(walcl, sem),
}
objetivo = {"2026-11-03": 19, "2026-11-04": 17, "2026-11-09": 7}
for nombre, liq in medidas.items():
    liq = liq.dropna()
    diaria = len(liq) > 3000
    for etiqueta, n, v in ((("13 sem en 1 año", 13, 52),) if not diaria else (("91 d en 365", 91, 365), ("63 d en 252", 63, 252))):
        p = pct_rank((liq / liq.shift(n) - 1).dropna(), v)
        res = [round(float(p[p.index <= d].iloc[-1])) for d in objetivo]
        print(f"{nombre:28s} {etiqueta:16s} -> {res}  referencia {list(objetivo.values())}", flush=True)
