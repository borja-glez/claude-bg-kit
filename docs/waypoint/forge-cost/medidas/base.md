# Línea base de consumo (forge-cost, F1)

- **Fecha:** 2026-10-14 00:29 (+02:00). Los ficheros de uso siguen creciendo (la sesión que coordina este trabajo escribe uno); esta línea base es su estado en ese momento.
- **Comando:** `node scripts/usage-report.mjs E:/work/claude-bg-kit/.forge/usage E:/work/reparto/.forge/usage E:/work/reparto-20261012/.forge/usage`
- **Directorios:** `.forge/usage` de `claude-bg-kit` (6 ficheros), `../reparto` (16) y `../reparto-20261012` (2): 23 ficheros de sesión, 510,36 $ sumando sus bucles.
- **Precios:** los de `src/lib/prices.ts` (2026-10-12), escritura de caché a la tarifa de 1 hora. El reparto se calcula con el precio del modelo sobre los tokens de cada bucle; la última columna es el coste registrado menos ese cálculo.

## Por agente

La salida del script tal cual (números con punto decimal). `kind` sin el prefijo `forge:`; el modelo sin el sufijo `[1m]`.

| kind | model | effort | runs | steps | steps/run | cost $ | $/run | input | output | cache read | cache write | recorded - priced $ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| main | claude-opus-5-5 | xhigh | 21 | 2722 | 130 | 279.33 | 13.30 | 0 % | 13 % | 65 % | 22 % | -0.28 |
| forge-impl-heavy | claude-opus-5-5 | xhigh | 21 | 793 | 38 | 75.32 | 3.59 | 0 % | 33 % | 25 % | 42 % | 0.00 |
| forge-review-correctness | claude-opus-5-5 | xhigh | 56 | 830 | 15 | 50.16 | 0.90 | 0 % | 32 % | 15 % | 54 % | 0.00 |
| forge-impl | claude-opus-5-5 | medium | 25 | 698 | 28 | 37.10 | 1.48 | 0 % | 29 % | 22 % | 49 % | 0.00 |
| forge-review-security | claude-opus-5-5 | xhigh | 35 | 369 | 11 | 22.76 | 0.65 | 0 % | 33 % | 11 % | 56 % | -0.00 |
| Explore | claude-opus-5-5 | xhigh | 5 | 154 | 31 | 10.53 | 2.11 | 0 % | 22 % | 27 % | 51 % | 0.00 |
| main | claude-opus-5-5 | medium | 2 | 171 | 86 | 9.35 | 4.67 | 0 % | 17 % | 52 % | 31 % | 0.00 |
| forge-planner | claude-opus-5-5 | xhigh | 3 | 69 | 23 | 8.39 | 2.80 | 0 % | 43 % | 10 % | 48 % | 0.00 |
| forge-review-perf | claude-opus-5-5 | xhigh | 18 | 110 | 6 | 5.92 | 0.33 | 0 % | 20 % | 8 % | 72 % | 0.00 |
| forge-verify | claude-sonnet-5-5 | high | 13 | 179 | 14 | 5.24 | 0.40 | 0 % | 20 % | 18 % | 62 % | 0.00 |
| waypoint:design-critic | claude-opus-5-5 | xhigh | 2 | 9 | 5 | 2.54 | 1.27 | 0 % | 62 % | 1 % | 37 % | 0.00 |
| general-purpose | claude-sonnet-5-5 | medium | 3 | 31 | 10 | 1.32 | 0.44 | 0 % | 18 % | 13 % | 70 % | 0.00 |
| forge-scout | claude-opus-5-5 | medium | 2 | 23 | 12 | 1.25 | 0.63 | 0 % | 17 % | 14 % | 69 % | 0.00 |
| waypoint:design-critic | claude-opus-5-5 | medium | 2 | 6 | 3 | 0.58 | 0.29 | 0 % | 46 % | 2 % | 52 % | -0.00 |
| forge-impl-light | claude-sonnet-5-5 | xhigh | 1 | 20 | 20 | 0.35 | 0.35 | 0 % | 34 % | 17 % | 49 % | -0.00 |
| forge-impl-light | claude-sonnet-5-5 | medium | 2 | 12 | 6 | 0.16 | 0.08 | 0 % | 25 % | 7 % | 68 % | 0.00 |
| forge-impl-light | claude-sonnet-5-5 | low | 1 | 1 | 1 | 0.03 | 0.03 | 0 % | 2 % | 0 % | 98 % | 0.00 |
| forge-review-perf | claude-opus-5-5 | high | 1 | 1 | 1 | 0.03 | 0.03 | 0 % | 19 % | 3 % | 78 % | 0.00 |
| forge-mech | claude-haiku-5-5 | low | 1 | 1 | 1 | 0.00 | 0.00 | 0 % | 6 % | 0 % | 94 % | 0.00 |

Total sobre los bucles: 510,36 $.

**Coste registrado frente al calculado.** Coinciden en todos los grupos salvo en `main` Opus xhigh, donde el registrado es 0,28 $ menor (un 0,1 %). Es lo esperable: lens registra cada paso con `stepCost`, que cobra a 1,25 × entrada la parte escrita en la caché de 5 minutos, y el fichero solo guarda el total de escritura, que aquí se cobra entero a la tarifa de 1 hora.

## Por sesión

Coste registrado de la sesión, número de bucles y coste por grupo (los de `groupOf` en `src/lens/usage-summary.ts`). La sesión `claude-bg-kit` de 8 bucles es la que coordina este trabajo: seguía creciendo al medir.

| project | label | cost $ | loops | main | impl | review | verify | plan | other |
|---|---|---|---|---|---|---|---|---|---|
| claude-bg-kit | campaign-fixes | 170.61 | 50 | 57.68 | 63.51 | 34.27 | — | — | 10.53 |
| reparto | api | 90.02 | 20 | 63.78 | 3.39 | 4.95 | 0.98 | 3.99 | — |
| claude-bg-kit | claude-bg-kit | 71.68 | 6 | 57.03 | 6.83 | 6.10 | — | — | — |
| claude-bg-kit | claude-bg-kit | 24.70 | 11 | 13.98 | 3.60 | 4.55 | — | — | 1.32 |
| reparto | api | 22.28 | 8 | 13.81 | 5.21 | 1.52 | — | 1.25 | — |
| claude-bg-kit | claude-bg-kit | 21.54 | 8 | 13.05 | 1.56 | 0.03 | — | 5.72 | — |
| reparto | api | 18.15 | 15 | 9.11 | 3.45 | 3.19 | 1.46 | — | — |
| reparto | web | 11.53 | 11 | 6.48 | 1.43 | 1.85 | 0.88 | — | — |
| reparto | task-T011 | 11.45 | 9 | 4.98 | 2.64 | 2.68 | 0.61 | — | — |
| reparto-20261012 | reparto | 8.21 | 4 | 5.70 | — | — | — | 1.81 | — |
| reparto | task-T006 | 8.06 | 6 | 3.88 | 1.78 | 1.71 | 0.41 | — | — |
| reparto | task-T007 | 7.92 | 5 | 3.78 | 2.20 | 1.62 | — | — | — |
| reparto | task-T005 | 7.82 | 5 | 3.15 | 2.33 | 1.99 | — | — | — |
| reparto | task-T008 | 7.62 | 6 | 3.51 | 1.73 | 1.74 | 0.43 | — | — |
| reparto | task-T009 | 7.42 | 6 | 3.40 | 1.77 | 1.78 | 0.47 | — | — |
| reparto-20261012 | api | 7.41 | 11 | 3.64 | 1.90 | 2.17 | — | — | — |
| reparto | task-T010 | 7.12 | 5 | 3.17 | 2.08 | 1.53 | — | — | — |
| reparto | task-T004 | 7.06 | 5 | 3.28 | 1.59 | 2.07 | — | — | — |
| reparto | task-T001 | 6.60 | 5 | 3.31 | 1.58 | 1.51 | — | — | — |
| claude-bg-kit | band-stack | 6.33 | 3 | 3.80 | 1.04 | 0.70 | — | — | — |
| reparto | task-T002 | 5.41 | 5 | 2.74 | 1.70 | 1.06 | — | — | — |
| reparto | task-T012 | 4.93 | 5 | 2.67 | 1.24 | 0.93 | — | — | — |
| reparto | task-T003 | 4.36 | 5 | 2.74 | 0.41 | 0.94 | — | — | — |

Las sesiones miembro de `reparto` (`task-T001` a `task-T012`, modo `sessions`) cuestan 4,4–11,5 $ por tarea, y su `main` (la sesión miembro) se lleva 2,7–5,0 $ de ellas, como dice el diseño.

## Diferencias con la tabla de Contexto del diseño

| Bloque | Contexto (2026-10-13) | Ahora | Diferencia |
|---|---|---|---|
| Total | ≈452 $, 21 sesiones | 510,36 $, 23 ficheros | +58 $ |
| Sesión principal (Opus xhigh) | 254 $, 65 % lectura de caché | 279,33 $, 65 % lectura de caché | +25 $ |
| `forge-impl-heavy` (xhigh) | 75 $, 3,59 $/ejecución | 75,32 $, 3,59 $/ejecución | igual |
| `forge-impl` | 1,61 $/ejecución | 1,48 $/ejecución (25 ejecuciones) | −0,13 $ |
| `forge-review-correctness` (xhigh) | 42 $, 0,87 $; 54 % escritura, 32 % salida | 50,16 $, 0,90 $; 54 % escritura, 32 % salida | +8 $ |
| `forge-review-security` (xhigh) | 22 $, 0,63 $ | 22,76 $, 0,65 $ | ≈ igual |
| `forge-review-perf` (xhigh) | 6 $, 0,33 $ | 5,92 $, 0,33 $ | igual |

`forge-impl-heavy` cuadra exactamente (3,59 $ por ejecución). Las diferencias vienen de lo que se registró después del análisis:
- Dos ficheros nuevos de `claude-bg-kit`: `band-stack` (6,33 $, empezó a las 21:19 del 13) y la sesión que coordina este trabajo (21,54 $, con el planner, las pruebas de esfuerzo de `impl-light`/`mech`/`review-perf` y tres `forge-impl` pequeños).
- Sesiones que siguieron creciendo después del análisis (`campaign-fixes` hasta las 19:28, la `claude-bg-kit` de 11 bucles hasta las 21:06): más pasos de `main` y cinco ejecuciones más de `review-correctness`. Sin esos dos ficheros nuevos y sin la sesión de 11 bucles, correctness queda en 44,92 $ y 0,88 $ por ejecución, y `main` xhigh en 248,49 $; el resto hasta los 452 $ no se puede atribuir con los ficheros, que solo guardan el total acumulado.
- `forge-impl` baja a 1,48 $ porque los tres `forge-impl` nuevos son pequeños (0,26–0,80 $).
- `main` en medium (2 sesiones, 9,35 $) y `Explore` (10,53 $) no salen en la tabla del diseño.
