<div align="center">

# 🔍 lens

**Un panel de progreso en vivo para las sesiones de Claude Code.**
El modelo y el esfuerzo en uso, el roadmap, las etapas y ejecuciones de forge, las ejecuciones de superpowers, pendientes, subagentes, tareas de Claude Code, y lo que cuesta todo.

[English](README.md) · **Español** · [← bg-kit](../../README.es.md)

![versión 0.9.0](https://img.shields.io/badge/versi%C3%B3n-0.9.0-b4befe?style=flat-square)
![sin coste en tokens](https://img.shields.io/badge/coste%20en%20tokens-ninguno-a6e3a1?style=flat-square)

</div>

<p align="center"><img src="../../docs/assets/lens.es.svg" alt="El panel de lens: modelo y esfuerzo, roadmap, etapas de forge, subagentes y la tarjeta Consumo" width="100%"></p>

## Contenido

- [Por qué lens](#por-qué-lens)
- [Instalación](#instalación)
- [Uso](#uso)
- [Qué enseña el panel](#qué-enseña-el-panel)
- [Consumo y coste](#consumo-y-coste)
- [La banda](#la-banda)
- [Cómo lee](#cómo-lee)
- [Desarrollo](#desarrollo)

## Por qué lens

Las ejecuciones largas pasan fuera de la vista: subagentes en segundo plano, revisores en paralelo, sesiones en otros worktrees. lens las pone en una sola pantalla junto a tu conversación, para que veas de un vistazo si las cosas avanzan, qué está atascado y cuánto está costando. Solo observa y nunca añade tokens a tus sesiones.

## Instalación

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install lens@bg-kit
```

lens detecta [waypoint](../waypoint/README.es.md), [forge](../forge/README.es.md) y [superpowers](https://github.com/obra/superpowers) por sus ficheros en el proyecto, y no necesita ninguno instalado. Reinicia Claude Code después de instalar o actualizar.

## Uso

- `/lens` abre el panel lateral. Con waypoint instalado, el botón **Panel** de su banda hace lo mismo.
- El panel y la banda se dibujan en la terminal y en la pestaña Code de la app de escritorio.

| Dónde | Cómo se ve |
| --- | --- |
| **Terminal** | Marcos redondeados, barras de bloques y cajas de tareas en celdas. Los spinners, el brillo que recorre las barras activas y las cajas que laten se animan en el hilo de dibujo con un módulo de superficie (`hooks/pulse.js`), así que no cuestan escrituras de estado. |
| **App de escritorio** | Cada tarjeta es un SVG con barras en degradado, un brillo que se mueve, cajas que respiran y anillos que giran. Sigue el tema claro u oscuro, deja de moverse con movimiento reducido, y su texto alternativo dice todo lo que enseña la tarjeta. |

## Qué enseña el panel

Cada sección es una tarjeta con su propio color (la paleta Catppuccin del roadmap) y solo aparece si existe su fuente. Las cajas de tareas tienen el color de su estado: hecha (azul), en curso (naranja, latiendo), bloqueada (amarillo), devuelta por la revisión (rojo) y pendiente (solo contorno). Los agentes tienen el color de su nivel: la escalera de implementadores de forge va de frío a cálido (mech, light, impl, heavy, fable), y los revisores según lo que juzgan (correctness, security, perf).

| Tarjeta | Fuente | Qué ves |
| --- | --- | --- |
| **Ahora** | la sesión | El modelo principal y su esfuerzo (`Opus 5.5 · esfuerzo alto`), la herramienta en marcha y cuánto lleva el turno. |
| **Roadmap** | plan de waypoint | Porcentaje, fase, una caja por tarea del frente, la tarea en curso con sus minutos frente a su estimación, mensajes y decisiones pendientes. |
| **forge** | `.forge/status.json` | La última tarea de forge clasificada o trabajada en el día, descrita más abajo. |
| **Ejecución** | `.forge/execution/` y `.forge/live/` | Mientras hay una ejecución de forge activa, una fila por tarea en marcha con su título, etapa, nivel, agente, duración y ronda, y una ficha de vida (viva, sin señal a los 7 minutos, parada a los 12). Cada fila enseña el título de la tarea y la tarjeta el total real de la ejecución; una ejecución efímera se ve igual que una de plan. Las sesiones ejecutoras y manuales tienen sus propias filas (`manual · T009`) y cada franja está viva o no según su propia sesión. Debajo, listas atenuadas de las tareas en cola, en conflicto, bloqueadas y huérfanas. Sustituye a la antigua tarjeta de enjambre. |
| **superpowers** | `.superpowers/sdd/<plan>/progress.md` | El plan activo y su registro de subagent-driven-development: tarea N/M, la ronda de arreglo actual y las últimas entradas. Un plan terminado sin pasos marcados se oculta. |
| **Pendientes** | TodoWrite | Hechos/total, el que está en curso y los siguientes. |
| **Subagentes** | Claude Code | Los subagentes en marcha, con su tipo, descripción, modelo, esfuerzo y tiempo. |
| **Tareas de Claude Code** | Claude Code | Tareas abiertas y hechas, y las últimas. |
| **Consumo** | la sesión y `.forge/usage/` | Tokens y dólares por parte, descritos en [Consumo y coste](#consumo-y-coste). |

**La tarjeta de forge** enseña:

- la tarea y su camino;
- las etapas (triaje → implementar → validar → verificar → revisar → veredicto, más diseño, plan y final en el camino Large), con la actual encendida; la etapa de verificar solo aparece cuando forge verifica la tarea;
- durante una ejecución, las etapas propias de la ejecución (brief, implementar, validar, verificar, revisar, veredicto, integrar) de la tarea que se trabaja;
- una caja por brief: aceptado, actual o pendiente;
- el último agente con su nivel, modelo y esfuerzo;
- una fila de verificación cuando la tarea se verificó: las superficies usadas, las comprobaciones superadas sobre el total y el resultado (pass, fail o blocked);
- los últimos validadores (✓/✗), el veredicto con su nota y la ronda de revisión frente a su límite.

Debajo de las etapas lista hasta 5 propuestas pendientes, cada una como `título · categoría · riesgo` con botones **Aprobar** y **Rechazar** que ejecutan `/forge:decide`. Mientras hay una ejecución `/forge:infinite` activa, la tarjeta también enseña `∞ N/M · quedan H h` y las 3 propuestas autoaprobadas más recientes. Si forge decidió algo sin preguntar en el último día, la tarjeta enseña además `⚑ N decisiones automáticas` y la última de peso (`/forge:decisions` las lista).

## Consumo y coste

La tarjeta **Consumo** responde a tres preguntas: qué modelo trabaja, cuánto lleva gastado y cuánto cuesta el método.

- **Esta sesión ▸ ejecución.** La vista de ejecución suma todas las sesiones de la ejecución de forge en curso (la coordinadora de la ejecución y sus tareas) a partir de `.forge/usage/<sesión>.json`. Aparece mientras hay una ejecución activa o una que terminó en las últimas 12 horas.
- **Grupos.** Sesión principal, Implementadores, Revisores, Verificación (los agentes `forge-verify`), Planificación y scout, Otros subagentes y Seguimiento ≈ (una estimación del contexto que se va en la gestión de waypoint y forge). Cada grupo enseña su modelo dominante, sus tokens, sus dólares y su porcentaje.
- **Comprobación con `/cost`.** El total de la sesión se compara con el coste del propio Claude Code. Aparece un ⚠ si los dos difieren en más de un 10 %, por ejemplo cuando un modelo falta en la tabla de precios o lens cargó con la sesión ya empezada.
- **Sin forge (estimado).** El mismo trabajo hecho solo por la sesión principal, con su modelo y sin revisión. Siempre va marcado como estimación, porque en una sola sesión el contexto crecería y costaría más, y nada se revisaría.
- **Los precios** salen de una tabla fechada en el código (`src/lib/prices.ts`). Un modelo sin precio enseña tokens pero no dólares, y los totales llevan `≥`.

lens mide desde que carga, con los recuentos de tokens que Claude Code da en cada petición. Nunca lee transcripciones ni llama a un modelo. El modo rápido no se tarifica aparte; la comprobación con `/cost` lo delata.

## La banda

Cuando Claude tiene pendientes abiertos o subagentes en marcha, y waypoint no está dibujando su propia banda, lens dibuja una banda sobre el prompt. Enseña la ejecución más concreta que haya en marcha (una ejecución de forge activa; si no, la última tarea de forge, el roadmap, superpowers o los pendientes) con su barra, sus cajas de tareas y su recuento, luego el consumo de esta sesión (`· 1,8 M tok · 6,2 $`), **Panel** y **×**. **×** la oculta hasta la siguiente sesión.

## Cómo lee

- Con el panel abierto, lens lee los ficheros cada 10 s y después de cada turno.
- Con el panel cerrado, solo lee si hay actividad (pendientes abiertos o subagentes en marcha), cada 30 s, para la banda.
- Sin actividad y con el panel cerrado, solo guarda en memoria un pequeño registro de la actividad de la sesión.
- El estado del panel solo se escribe con el panel abierto, y los ficheros de consumo solo en proyectos que tienen `.forge/`.
- `.forge/run.json` no se lee si pasa de 16 KiB, solo se leen los 50 ficheros de propuestas más recientes, y los ficheros de consumo de más de 256 KiB se ignoran.

## Desarrollo

El plugin es un mod: `src/lens/register.tsx`, empaquetado en `hooks/register.js` con `npm run build` desde la raíz del repositorio (sube el resultado).

- `claude plugin validate plugins/lens` comprueba el manifiesto, el módulo de hooks y su contrato de estado.
- `claude plugin test plugins/lens` ejecuta `plugins/lens/tests/*.test.ts` contra el motor.
- `npm run typecheck:mod` comprueba los tipos del mod.

Sube la versión en `plugin.json` con cada cambio: la caché de plugins instalados va por versión.
