# Prompt usado para construir el índice (Claude Code)

## Contexto (se mantiene)
- Repo público `correderalorarafael-lang/backtester` (GitHub Pages: https://correderalorarafael-lang.github.io/backtester/), clon local `C:\Users\corre\backtester`. Página estática, sin servidor; Chart.js 4.4.1 desde cdnjs; fuentes IBM Plex; mismos tokens de color que `index.html`.
- Velas de BTC: API pública de OKX. Sin claves de pago. Los datos se calculan en GitHub Actions (Python 3.12 + pandas) y la página solo lee un JSON del propio repo.

## Tarea
Construye un índice compuesto 0-100 que diga si Bitcoin está barato (100 = zona de suelo) o caro (0 = zona de techo), con 6 componentes puntuados de 0 a 10 (entero, redondeado y acotado), y total = media de los 6 × 10, redondeado.

| Letra | Componente | Fuente | Puntuación |
|---|---|---|---|
| F | Miedo y codicia | api.alternative.me/fng (diario) | 10 − (valor actual + media 7 días)/2/10 (miedo = barato; corregido el 10-nov-2026, antes iba al revés) |
| R | RSI 14 diario (Wilder) | velas diarias BTC-USDT de OKX | 10 − RSI/10 |
| E | Distancia a la EMA 200 diaria | OKX | 5 − distancia%/5 (−25% → 10, +25% → 0) |
| L | Liquidez global (Fed neta + BCE + BoJ, en USD) | FRED: WALCL − WTREGEN − RRPONTSYD + ECBASSETSW×DEXUSEU + JPNASSETS/DEXJPUS | percentil P del cambio a 13 semanas dentro del último año; 10 − P/10 |
| D | Índice del dólar (DXY) | Yahoo DX-Y.NYB (respaldo FRED DTWEXBGS) | percentil P del nivel en 5 años; 10 − P/10; mostrar cambio a 1 mes |
| I | Interés (búsquedas "bitcoin") | Google Trends desde 2004 (pytrends); si falla, visitas a Wikipedia "Bitcoin" escaladas a su máximo | 10 − valor/10 |

Zonas del total: 0-25 techo, 25-40 caro, 40-65 neutral, 65-80 barato, 80-100 suelo.

## Entregables
1. `indice/calcular.py`: descarga todo, calcula el índice actual y su historial diario desde 2021, y escribe `data/indice.json` con `{actualizado, actual: {total, zona, componentes[{letra, nombre, puntos, detalle}]}, historia: [[fecha, total, precio, F, R, E, L, D, I]...], fuentes}`. Si una fuente falla, reutiliza el último valor guardado y márcalo como no actualizado; si fallan todas, no sobrescribas el JSON.
2. `.github/workflows/indice.yml`: diario a las 02:15 UTC + botón manual; instala pandas y pytrends, ejecuta el script y hace commit solo de `data/indice.json`, con reintento de push.
3. `indice.html`: barra 0-100 con marcador y zona, 6 tarjetas (letra, nombre, x/10, barra, línea de detalle con el dato bruto), gráfico del índice y gráfico del precio de BTC (dos gráficos, nunca doble eje), tabla del método. Enlace cruzado con `index.html`. Claro y oscuro, móvil a 400 px.

## Límites
- Solo crea o edita: `indice/`, `data/indice.json`, `.github/workflows/indice.yml`, `indice.html` y el enlace en la cabecera de `index.html`.
- No uses el nombre ni la marca de ningún índice o creador ajeno; las fórmulas son propias y se documentan en la página.
- Ninguna clave ni secreto en el código.

## Hecho cuando
- `python indice/calcular.py` termina sin error y escribe un JSON con los 6 componentes y más de 1.000 días de historia.
- El workflow corre en verde una vez lanzado a mano.
- La página publicada muestra el índice, las 6 tarjetas y los dos gráficos sin errores de consola.
- Al acabar, informa de la puntuación actual, de las fuentes que fallaron y de las fórmulas usadas.
