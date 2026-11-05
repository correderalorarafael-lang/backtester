// Comprueba que engine.js da lo mismo que los bots en Python. Antes: python test/exportar.py
// Uso: node test/comprobar.js
const fs = require("fs");
const path = require("path");
const Motor = require("../engine.js");
const { PRESETS } = require("../presets.js");

const datos = JSON.parse(fs.readFileSync(path.join(__dirname, "datos.json"), "utf8"));
const aVelas = (rows) => rows.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));

function comprobar(nombre, preset, extra, d) {
  const data = Object.fromEntries(Object.entries(d.velas).map(([p, r]) => [p, aVelas(r)]));
  const res = Motor.run(data, { ...preset, ...extra });
  const ok = Math.abs(res.saldo - d.ref.saldo) < 0.01 && res.operaciones.length === d.ref.ops;
  console.log(`${ok ? "OK " : "MAL"} ${nombre}: JS ${res.saldo.toFixed(2)} (${res.operaciones.length} ops)  Python ${d.ref.saldo.toFixed(2)} (${d.ref.ops} ops)`);
  return ok;
}

const ok1 = comprobar("cripto definitiva", PRESETS.definitiva, { desde: "2022-01-01", hasta: "2026-10-27" }, datos.cripto);
// gold_bot no tiene límite de pérdida diaria ni filtra por par de régimen
const ok2 = comprobar("oro", PRESETS.oro, { desde: "2022-01-01", hasta: "2026-10-31", pares: ["XAU"] }, datos.oro);
process.exit(ok1 && ok2 ? 0 : 1);
