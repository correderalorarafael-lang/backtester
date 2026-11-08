/* Estrategias predefinidas: las dos que corren en los bots, con los mismos parámetros. */
(function (root) {
  const comun = {
    capital: 1000, riesgo: 0.01, perdidaDiaria: 0.04, maker: 0.0002, taker: 0.0005, maxApal: 20,
    atrN: 14, regRapida: 50, regLenta: 200, parRegimen: "BTC", fuerzaVelas: 42, fuerzaExcluir: 3,
  };
  const PRESETS = {
    definitiva: {
      ...comun, nombre: "EmaFinal definitiva (cripto)", tf: "4H",
      pares: ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "AVAX", "LINK", "NEAR"],
      rapida: 8, lenta: 21, tendencia: 200, atrMult: 2, salidaCompleta: false, direccion: "ambos",
      regimen: true, huecosAlcista: [3, 1], huecosBajista: [1, 3], fuerza: true, maxAbiertas: 4, sinFinde: false,
    },
    definitiva15: {},  // se rellenan abajo: la definitiva con más riesgo y el límite diario en proporción
    definitiva2: {},
    oro: {
      ...comun, nombre: "Oro EMA 13/34/200", tf: "1H", pares: ["XAU"], perdidaDiaria: 1,
      rapida: 13, lenta: 34, tendencia: 200, atrMult: 1.5, salidaCompleta: true, direccion: "largos",
      regimen: false, huecosAlcista: [1, 1], huecosBajista: [1, 1], fuerza: false, maxAbiertas: 1, sinFinde: true,
    },
  };
  PRESETS.definitiva15 = { ...PRESETS.definitiva, nombre: "EmaFinal definitiva · riesgo 1,5%", riesgo: 0.015, perdidaDiaria: 0.06 };
  PRESETS.definitiva2 = { ...PRESETS.definitiva, nombre: "EmaFinal definitiva · riesgo 2%", riesgo: 0.02, perdidaDiaria: 0.08 };
  if (typeof module !== "undefined" && module.exports) module.exports = { PRESETS };
  else root.PRESETS = PRESETS;
})(typeof window !== "undefined" ? window : globalThis);
