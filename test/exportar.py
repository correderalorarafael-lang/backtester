"""Exporta las velas que usan los bots y calcula en Python los resultados de referencia para test/comprobar.js.
Uso (desde la carpeta backtester): python test/exportar.py   -> test/datos.json (no se sube a GitHub)
"""
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, r"C:\Users\corre\ema-bot-repo")
import bot  # noqa: E402
import gold_bot  # noqa: E402

OKX = Path(r"C:\Users\corre\freqtrade\user_data\data\okx\futures")
DUKAS = Path(r"C:\Users\corre\freqtrade\user_data\data\dukascopy\long\XAUUSD_1h.csv")
START = pd.Timestamp("2022-01-01", tz="UTC")
bot.telegram = lambda m: None


def velas(d):
    return [[int(t.value // 10**6), o, h, l, c] for t, o, h, l, c in zip(d.date, d.open, d.high, d.low, d.close)]


def cripto(end=pd.Timestamp("2026-10-27", tz="UTC")):
    df = {}
    for p in bot.PAIRS:
        d = pd.read_feather(OKX / f"{p}_USDT_USDT-4h-futures.feather")
        d["date"] = pd.to_datetime(d.date, utc=True)
        df[p] = bot.indicators(d[d.date < end].reset_index(drop=True))
    pos = {p: pd.Series(d.index, index=d.date) for p, d in df.items()}
    btc = df["BTC"].set_index("date").close.resample("1D").last().dropna()
    daily = pd.DataFrame({"date": btc.index, "close": btc.to_numpy()})
    st = {"balance": bot.START_BALANCE, "open": [], "closed": [], "seen": {}}
    for t in sorted(set().union(*(d.date[d.date >= START] for d in df.values()))):
        frames = {p: df[p].iloc[:pos[p][t] + 1] for p in bot.PAIRS if t in pos[p].index}
        frames.update({tr["pair"]: df[tr["pair"]].iloc[:pos[tr["pair"]].asof(t) + 1] for tr in st["open"]})
        bot.step(st, frames, daily)
    for tr in list(st["open"]):
        last = df[tr["pair"]].iloc[-1]
        bot._close(st, tr, last.close, last.date, "fin", bot.MAKER, [])
    return {p: velas(d) for p, d in df.items()}, {"saldo": st["balance"], "ops": len(st["closed"])}


def oro(end=pd.Timestamp("2026-10-31", tz="UTC")):
    raw = pd.read_csv(DUKAS)
    raw["date"] = pd.to_datetime(raw.date, format="ISO8601", utc=True)
    raw = raw[raw.date < end].sort_values("date").reset_index(drop=True)
    ind = gold_bot.indicators(raw).set_index("date")
    st = {"balance": bot.START_BALANCE, "open": [], "closed": []}
    for row in raw.itertuples():  # mismo orden que gold_bot.step: stop, salida y después entrada
        for tr in list(st["open"]):
            if row.low <= tr["stop"]:
                bot._close(st, tr, min(row.open, tr["stop"]), row.date, "stop", bot.TAKER, [])
            elif row.date in ind.index and ind.at[row.date, "exit_long"]:
                bot._close(st, tr, row.close, row.date + gold_bot.H1, "cruce contrario", bot.MAKER, [])
        if row.date < START or row.date not in ind.index or st["open"] or not ind.at[row.date, "long"]:
            continue
        entry, stop = row.close, ind.at[row.date, "stop_long"]
        dist = (entry - stop) / entry
        if dist > 0:
            bal = st["balance"]
            st["open"].append({"pair": "XAU", "side": 1, "entry": entry, "stop": stop, "risk": bot.RISK * bal,
                               "qty": bot.RISK * bal / (dist + bot.MAKER + bot.TAKER) / entry,
                               "open_time": row.date.isoformat(), "checked": row.date.isoformat()})
    for tr in list(st["open"]):
        bot._close(st, tr, raw.close.iloc[-1], raw.date.iloc[-1], "fin", bot.MAKER, [])
    return velas(raw), {"saldo": st["balance"], "ops": len(st["closed"])}


if __name__ == "__main__":
    c_velas, c_ref = cripto()
    assert abs(c_ref["saldo"] - 16405.52) < 0.01, c_ref
    o_velas, o_ref = oro()
    out = {"cripto": {"velas": c_velas, "ref": c_ref}, "oro": {"velas": {"XAU": o_velas}, "ref": o_ref}}
    Path(__file__).with_name("datos.json").write_text(json.dumps(out))
    print("referencias:", c_ref, o_ref)
