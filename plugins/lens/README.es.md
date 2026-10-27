<div align="center">

# 🔍 lens

**Un panel de progreso en vivo para las sesiones de Claude Code.**
El modelo y el esfuerzo en uso, el roadmap, las etapas y ejecuciones de forge, las ejecuciones de superpowers, lo que te toca, pendientes, subagentes, tareas de Claude Code, y lo que cuesta todo.

[English](README.md) · **Español** · [← bg-kit](../../README.es.md)

![versión 0.16.0](https://img.shields.io/badge/versi%C3%B3n-0.16.0-b4befe?style=flat-square)
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

- `/lens` abre el panel lateral donde se acopla: en fullscreen, desde 110 columnas. Fuera de fullscreen, o más estrecho, deja en su lugar una **foto** del panel en el transcript: una línea, `lens · 14:02:11 #1 · 3 tareas`, que un hook de `CommandOutput` dibuja como las tarjetas, quietas; los ficheros se leen una vez y no se escribe nada. `/lens live` abre el pane de todos modos (en línea sobre el prompt donde no se acopla), y `/lens foto` (o `/lens photo`) da siempre la foto. El botón **Panel** de cualquiera de las dos bandas hace lo que haría `/lens`.
- En línea, el pane pide las filas que ocupan sus tarjetas (entre 6 y un tercio de la pantalla), las dibuja sin marco y acaba en `↓ N más · /lens foto` cuando no caben; acoplado, pide 56 columnas. Se cierra con la marca del propio motor (o `ctrl+x x`). Una fila larga de cajas de tareas se queda en dos filas de cajas, con el resto resumido en la fila de debajo (`+42 ■ · 12 □`), y el agente que estás mirando despliega su tarea. Una foto se dibuja al ancho de la conversación, más estrecha junto a un pane acoplado.
- **Teclado.** Fuera de fullscreen el clic no llega a la banda: `ctrl+x tab` le da el teclado, sus botones se leen `p: Panel` y `x: ×`, y la línea de pistas bajo el prompt acaba en `ctrl+x tab · banda`. Con el pane enfocado, Tab recorre sus botones (Aprobar y Rechazar de las propuestas no llevan letra).
- **Una línea.** Fuera de fullscreen, o con menos de 3 filas sobre el prompt, lens deja una línea de estado bajo el prompt (`$.ui.status`) mientras esta sesión tiene trabajo de forge propio: `lens · T002 revisar r2 · 3 subagentes · 1,20 $`. Mientras corre un turno, el spinner nombra la tarea (`T002 · revisar r2`) cuando el motor no tiene nada propio que decir, y el modo auto de forge y la ejecución infinita salen como etiquetas de modo (`forge auto`, `∞ 2/5`). Un aviso dice cuándo una tarea de esta sesión recibe un veredicto (nunca su nota), empieza una ronda de revisión nueva o se integra, uno cada 5 segundos como mucho, y una notificación dice cuándo termina una ejecución tuya de 20 minutos o más.
- El panel y la banda se dibujan en la terminal y en la pestaña Code de la app de escritorio.

| Dónde | Cómo se ve |
| --- | --- |
| **Terminal** | Marcos redondeados, barras de bloques y cajas de tareas en celdas. Los spinners, el brillo que recorre las barras activas y las cajas que laten se animan en el hilo de dibujo con un módulo de superficie (`hooks/pulse.js`), así que no cuestan escrituras de estado. |
| **App de escritorio** | Cada tarjeta es un SVG con barras en degradado, un brillo que se mueve, cajas que respiran y anillos que giran. Sigue el tema claro u oscuro, deja de moverse con movimiento reducido, y su texto alternativo dice todo lo que enseña la tarjeta. |

## Qué enseña el panel

Cada sección es una tarjeta con su propio color (la paleta Catppuccin del roadmap) y solo aparece si existe su fuente. Los ficheros que lee son los del **proyecto de esta conversación**, que se busca como cuenta [Cómo lee](#cómo-lee): una ejecución de forge que la conversación coordina o en la que es miembro, o un vínculo de waypoint suyo, la unen al proyecto, y todo sale como antes, incluido el trabajo de otras sesiones en él. Una tarea de forge propia sin ejecución, o un registro o un plan de superpowers que escribió, la anclan solo a ese trabajo: sale solo ese trabajo y lo que te toca ligado a sus tareas. Una **sesión limpia**, sin nada de eso, no enseña nada leído de los ficheros del proyecto (ni Roadmap, ni Ejecución, ni Tareas en curso, ni Te toca, ni superpowers, ni propuestas, ni ejecución infinita, ni decisiones automáticas); se quedan Ahora, Subagentes, Consumo, Pendientes y Tareas de Claude Code, que vienen de la sesión sola, y su idioma es el ajuste `language` de Claude Code. Vale también si la sesión arrancó dentro del repositorio: la ejecución y las tareas de otra sesión no salen ahí, ni atenuadas, hasta que esta se une. Las cajas de tareas tienen el color de su estado: hecha (azul), en curso (naranja, latiendo), bloqueada (amarillo), devuelta por la revisión (rojo) y pendiente (solo contorno). Los agentes tienen el color de su nivel: la escalera de implementadores de forge va de frío a cálido (mech, light, impl, high, heavy, fable; `high` es `forge-impl-high`, Opus con esfuerzo alto), y los revisores según lo que juzgan (correctness, security, perf).

| Tarjeta | Fuente | Qué ves |
| --- | --- | --- |
| **Ahora** | la sesión | El modelo principal y su esfuerzo (`Opus 5.5 · esfuerzo alto`), la herramienta en marcha y cuánto lleva el turno. Sin turno abierto mientras trabajan subagentes, a cuántos espera y cuándo despierta la sesión (`esperando a 3 subagentes · despierta en 4m`), y cada trabajo en segundo plano sin fila de tarea (`validando T003 · 1m`). |
| **Te toca** | `.forge/` y las notas del roadmap, leídos con la banda de waypoint | Lo que espera tu respuesta, de lo más antiguo a lo más nuevo, hasta 6 filas y `+N`: la pregunta de una ronda de revisión, una fusión por autorizar, la confianza en los comandos de `.forge/config.yaml`, una ejecución parada, las preguntas abiertas del roadmap, las propuestas por decidir, un diseño listo para aprobar y un permiso de superficie. Cada fila dice dónde está, cómo se responde (la orden o, mientras esa conversación siga abierta, «te toca en la conversación de la coordinadora») y cuánto lleva esperando; una fuente que no se pudo leer lo dice. |
| **Roadmap** | el plan de waypoint del proyecto de esta conversación (su vínculo, o la ejecución que coordina o en la que es miembro) | Porcentaje, fase, una caja por tarea del frente, la tarea en curso con sus minutos frente a su estimación, mensajes y decisiones pendientes y, atenuadas, las últimas 3 tareas hechas del frente con sus minutos frente a la estimación (`✓ T7 · 22/30 min`, en ámbar si se pasa). |
| **Tareas en curso** | `.forge/status/` (un fichero por tarea) y `.forge/jobs/` | Una fila por tarea de forge (`[T002] Título · medium · revisar r2 · 12m`) y por ejecución de Workflow, con los agentes de esta sesión sangrados bajo sus propias filas. En un proyecto al que esta conversación se unió, la tarea de otra sesión sale atenuada y marcada durante 30 minutos desde su último movimiento (en una sesión limpia, o anclada solo por su propio trabajo, no sale); una hecha sale con ✓, y una que paró `/forge:stop` como «parada», durante 15 minutos. Un trabajo en segundo plano sustituye a la etapa (`validando`). La tarea desplegada lleva el detalle descrito más abajo. Cada agente va bajo su tarea por la línea `forge-task:` con la que empieza su prompt (si no, `Task id:`, una ruta `.forge/work/`, la tarea de su descripción o la tarea de su padre). |
| **Ejecución** | `.forge/execution/` y `.forge/live/` | Mientras hay una ejecución de forge activa, una fila por tarea en marcha con su título, etapa, nivel, agente, duración y ronda, y una ficha de vida (viva, sin señal a los 7 minutos, parada a los 12). Cada fila también enseña el tiempo total de la tarea (`implementar · 3m 02s · tarea 18m 04s`; tras un relanzamiento, el tiempo de la tarea cuenta desde el relanzamiento), la cabecera el tiempo desde que empezó la ejecución (`◷ 42m 10s`) y una línea atenuada las últimas 3 tareas terminadas (integradas o bloqueadas) con su duración (`✓ T3 12m 05s · T2 8m 30s`). Cada fila enseña el título de la tarea y la tarjeta el total real de la ejecución; una ejecución efímera se ve igual que una de plan. Las sesiones ejecutoras y manuales tienen sus propias filas (`manual · T009`) y cada franja está viva o no según su propia sesión. Debajo, listas atenuadas de las tareas en cola, en conflicto, bloqueadas y huérfanas. Sustituye a la antigua tarjeta de enjambre. Cada franja lista sus agentes. |
| **superpowers** | `.superpowers/sdd/<plan>/progress.md` | El plan activo y su registro de subagent-driven-development: tarea N/M, la ronda de arreglo actual y las últimas entradas. El plan es el que nombra el fichero `plan-path` del registro o su cabecera, con ruta relativa o absoluta (`X:/…`, `/x/…` o `/cygdrive/x/…`), dentro del proyecto o, desde un worktree, de su checkout principal, también por la ruta real de un proyecto bajo un enlace simbólico; si no se puede leer ningún plan, la tarjeta enseña las tareas hechas, sin total. Un plan terminado sin pasos marcados se oculta. |
| **Pendientes** | TodoWrite | Hechos/total, el que está en curso y los siguientes. Sale en cuanto la sesión llamó a TodoWrite. |
| **Subagentes** | Claude Code | Los subagentes en marcha, con su tipo, descripción, modelo, esfuerzo y tiempo y, atenuados con ✓, los últimos 5 que terminaron en los últimos 5 minutos con lo que tardaron. Solo se guardan en memoria, así que recargar lens los olvida. Un agente pintado bajo su tarea o su franja no se repite aquí; un teammate en espera entre turnos sale como «en espera». |
| **Tareas de Claude Code** | Claude Code | Tareas abiertas y hechas, y las últimas. Sale en cuanto corrió una llamada `TaskCreate` o `TaskUpdate` de la sesión, y se va cuando se borran sus tareas. |
| **Consumo** | la sesión y `.forge/usage/` | Tokens y dólares por parte, descritos en [Consumo y coste](#consumo-y-coste). |

**Pendientes y Tareas de Claude Code.** Desde Claude Code 2.1.233, los modelos más nuevos (Opus 5.5 entre ellos) no tienen TodoWrite ni las herramientas de tareas por defecto, así que estas dos tarjetas no salen: ninguna se pinta vacía. `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` en el entorno de Claude Code devuelve las herramientas, y con ellas las tarjetas.

**El detalle de la tarea desplegada** enseña:

- la tarea y su camino;
- el tiempo de la tarea hasta ahora en la cabecera (`✓ 14m 20s` cuando termina);
- las etapas (triaje → implementar → validar → verificar → revisar → veredicto, más diseño, plan y final en el camino Large), con la actual encendida; la etapa de verificar solo aparece cuando forge verifica la tarea;
- durante una ejecución, las etapas propias de la ejecución (brief, implementar, validar, verificar, revisar, veredicto, integrar) de la tarea que se trabaja;
- debajo de las etapas, lo que tardó cada una, la actual en vivo (`triaje 12s · implementar 5m 02s · validar 48s…`);
- una caja por brief: aceptado, actual o pendiente;
- el último agente con su nivel, modelo y esfuerzo;
- una fila de verificación cuando la tarea se verificó: las superficies usadas, las comprobaciones superadas sobre el total y el resultado (pass, fail o blocked);
- los últimos validadores (✓/✗, `· caché` cuando salen de la caché), el veredicto sin nota (`✓ aceptado en la ronda 2 · 0 C · 1 I · 3 m`) y la ronda de revisión frente a su límite; una verificación omitida dice por qué (`⊘ verify web · omitida: …`).

Debajo de las etapas lista hasta 5 propuestas pendientes, cada una como `título · categoría · riesgo` con botones **Aprobar** y **Rechazar** que ejecutan `/forge:decide`. Mientras hay una ejecución `/forge:infinite` activa, la tarjeta también enseña `∞ N/M · quedan H h` y las 3 propuestas autoaprobadas más recientes. Si forge decidió algo sin preguntar en el último día, la tarjeta enseña además `⚑ N decisiones automáticas` y la última de peso (`/forge:decisions` las lista). Cuando la tarea va en modo auto, el subtítulo de la tarjeta lo dice (modo auto).

## Consumo y coste

La tarjeta **Consumo** responde a tres preguntas: qué modelo trabaja, cuánto lleva gastado y cuánto cuesta el método.

- **Esta sesión ▸ ejecución.** La vista de ejecución suma todas las sesiones de la ejecución de forge en curso (la coordinadora de la ejecución y sus tareas) a partir de `.forge/usage/<sesión>.json`. Aparece mientras hay una ejecución activa o una que terminó en las últimas 12 horas. Una sesión cuenta solo lo que gastó desde que se unió a la ejecución; un fichero escrito por una versión anterior de lens cuenta entero y marca el total con `≥`.
- **Tiempo.** `◷ activo 1h 12m · desde el inicio 3h 40m`: el tiempo activo es la suma de los turnos de la sesión principal, con el turno en curso, y se guarda con los tokens en `.forge/usage/<session>.json`. La vista de ejecución suma las sesiones de la ejecución desde que empezó y lleva `≥` cuando una sesión escribió su fichero con una versión anterior de lens; debajo, atenuada, va la línea de esta sesión. Más de 24 h se lee `>24h`. Recargar lens en mitad de un turno hace que el tiempo activo de ese turno se quede corto; nunca lo cuenta dos veces.
- **Grupos.** Sesión principal, Implementadores, Revisores, Verificación (los agentes `forge-verify`), Planificación y scout, Otros subagentes y Seguimiento ≈ (una estimación del contexto que se va en la gestión de waypoint y forge). Cada grupo enseña su modelo dominante, sus tokens, sus dólares y su porcentaje.
- **Comprobación con `/cost`.** El total de la sesión se compara con el coste del propio Claude Code. Aparece un ▲ si los dos difieren en más de un 10 %, por ejemplo cuando un modelo falta en la tabla de precios o lens cargó con la sesión ya empezada. Una sesión reanudada compara solo lo que gastó desde que se reanudó.
- **Sin forge (estimado).** El mismo trabajo hecho solo por la sesión principal, con su modelo y sin revisión. Siempre va marcado como estimación, porque en una sola sesión el contexto crecería y costaría más, y nada se revisaría. Sale como horquilla cuando el seguimiento se releyó: el extremo bajo supone que todo el seguimiento viajaba como contexto en cada paso.
- **Los precios** salen de una tabla fechada en el código (`src/lib/prices.ts`). Un modelo sin precio enseña tokens pero no dólares, y los totales llevan `≥`.

lens mide desde que carga, con los recuentos de tokens que Claude Code da en cada petición. Nunca lee transcripciones ni llama a un modelo. El modo rápido no se tarifica aparte; la comprobación con `/cost` lo delata.

## La banda

Cuando Claude tiene subagentes en marcha o una tarea de forge de esta sesión en curso (los pendientes solos no la traen), y waypoint no está dibujando su propia banda (waypoint lo dice; su banda cerrada con **×** cuenta como no dibujada), lens dibuja una banda sobre el prompt. Nombra una a una las tareas de esta sesión en curso (`T001 impl · T002 rev r2 · T003 val`) o, si no, la ejecución más concreta que haya en marcha (una ejecución de forge activa, la tarea de forge, el roadmap, superpowers o los pendientes) con su recuento, luego lo que te toca (`» te toca 2`), los subagentes y el consumo de esta sesión (`· 1,8 M tok · 6,2 $`), **Panel** (`p`) y **×** (`x`), todo ajustado al ancho como la banda de waypoint; su barra y sus cajas de tareas solo salen desde 140 columnas. **×** la cierra para lo que enseña: una banda sobre otra cosa (otras tareas, una ejecución, los pendientes en lugar de un plan, un pendiente nuevo en la lista, un subagente nuevo) vuelve a salir, mientras que los mismos pendientes avanzando la dejan cerrada, y una `x` pulsada en los 5 segundos siguientes a que se vaya la banda de waypoint (una doble pulsación de su **×**) no la cierra.

## Cómo lee

- **Dónde.** La raíz de la sesión, o un repositorio justo debajo (un nivel, como mucho 50 carpetas por nombre que tengan `.waypoint/`, `.forge/`, `.superpowers/`, `docs/waypoint/` o `docs/superpowers/plans/`), elegido por el ancla de esta conversación: una ejecución que coordina o en la que es miembro, luego un vínculo suyo, luego una tarea de forge propia, luego un registro o un plan de superpowers que escribió. Un `cd` del shell no la mueve, ni tampoco una raíz de sesión que se mueve: el repositorio anclado se queda. Sin ancla no se lee nada de los ficheros del proyecto.
- **Cuándo busca otra vez.** Solo al empezar la sesión, al abrir el panel, en una llamada o una skill de waypoint o forge de esta sesión, cuando escribe un registro o un plan de superpowers, cuando se mueve la raíz de la sesión y cuando el repositorio anclado ya no guarda el ancla (un vínculo liberado, una ejecución cerrada). El refresco normal lee los ficheros del repositorio anclado y no recorre ningún otro.
- **Una carpeta que no puede leer.** Si la raíz de la sesión o el repositorio anclado se rechaza (una ubicación de red, falta de permiso), el panel y la foto lo dicen en una línea, `no se puede leer <ruta>: <motivo>`. Una carpeta que falta no dice nada, y una carpeta rechazada que no es ninguna de las dos solo va al registro de depuración.
- Con el panel abierto, lens lee los ficheros cada 10 s y después de cada turno.
- Con el panel cerrado, lee cada 30 s, para la banda y las superficies de una línea, solo mientras hay actividad: subagentes en marcha, una tarea de forge de esta sesión en curso que se movió en los últimos 30 minutos (o con un trabajo o un agente en marcha), una ejecución activa que esta sesión coordina o en la que trabaja, o una llamada a `forge.cjs` de esta sesión en los últimos 10 minutos. Una tarea que se quedó en curso más tiempo sigue saliendo, pero no hace leer nada.
- Una foto de `/lens` lee los ficheros una vez, al hacerla, y no escribe nada.
- Sin actividad y con el panel cerrado, solo guarda en memoria un pequeño registro de la actividad de la sesión. Con un ancla, en cuanto la sesión ha gastado algo, sigue escribiendo su fichero de consumo como mucho cada 30 s, mirando `.forge/execution.json` (un stat) para seguir una ejecución.
- El estado del panel solo se escribe con el panel abierto, y el fichero de consumo `.forge/usage/<sesión>.json` solo con un ancla, en el repositorio anclado.
- `.forge/run.json` no se lee si pasa de 16 KiB, solo se leen los 50 ficheros de propuestas más recientes, y los ficheros de consumo de más de 256 KiB se ignoran.
- Los estados de las tareas de forge se leen de `.forge/status/`, junto al ledger (el checkout principal en un worktree de tarea de forge): como mucho los 20 más recientes tocados en el día, de 64 KiB como mucho cada uno, y otra vez solo cuando cambian; sin esa carpeta, `.forge/status.json`. Los trabajos en segundo plano se leen de `.forge/jobs/` del checkout principal: como mucho 10, de 4 KiB como mucho cada uno.
- Lo que te toca se lee con la banda de waypoint, del checkout principal: los 20 registros más nuevos de `.forge/execution/auth/`, el `asked.json` de la ronda de revisión más nueva de cada tarea en marcha en revisión, las superficies por las que preguntó la ejecución abierta (`.forge/execution/asked/<ejecución>/`) con `.forge/local.yaml`, las 50 propuestas más nuevas y las 100 notas más nuevas de la caché del roadmap (`.waypoint/<proyecto>/dbcache/notes/`).
- lens no cuelga nada de los hooks clásicos de Claude Code, ni de los eventos que su plugin de seguridad integrado se salta donde está colocado (una máquina con ajustes gestionados, organizaciones Team y Enterprise): los subagentes empiezan en `agent.spawn` y acaban en su propio `turn.complete`, con la lista de agentes como comprobación; la tarjeta **Tareas de Claude Code** sigue las llamadas `TaskCreate` y `TaskUpdate`; y una compactación se nota por los menos mensajes que lleva la petición siguiente de la conversación (un rewind cuenta también como una). Así funciona igual en una instalación gestionada.

## Desarrollo

El plugin es un mod: `src/lens/register.tsx`, empaquetado en `hooks/register.js` con `npm run build` desde la raíz del repositorio (sube el resultado).

- `claude plugin validate plugins/lens` comprueba el manifiesto, el módulo de hooks y su contrato de estado.
- `claude plugin test plugins/lens` ejecuta `plugins/lens/tests/*.test.ts` contra el motor.
- `npm run typecheck:mod` comprueba los tipos del mod.

Sube la versión en `plugin.json` con cada cambio: la caché de plugins instalados va por versión.
