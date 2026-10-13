---
title: forge más barato sin perder revisión
project: forge-cost
locale: es
summary: Bajar el coste de forge donde los datos dicen que se va (sesiones miembro, implementadores en xhigh, rondas repetidas, contexto del coordinador) con el esfuerzo de cada agente atado al riesgo de la tarea, sin aflojar lo que bloquea.
pillars:
  - title: El esfuerzo sigue al riesgo
    text: Cada agente trabaja al nivel que pide la tarea (tamaño, zona sensible, último intento), no al del hábito ni al que hereda de la sesión.
  - title: Medido, no supuesto
    text: Cada cambio tiene su cifra antes y después en los ficheros de consumo de lens; lo que no se puede medir antes se valida con una prueba en sombra.
  - title: Lo que bloquea sigue bloqueando
    text: Un hallazgo critical, un validador en rojo o una regresión del arreglo siguen parando la tarea; solo se recorta trabajo que no cambia el resultado.
  - title: Cada sesión lee y hace solo lo suyo
    text: El coordinador y las sesiones miembro cargan el texto de su papel y resuelven cada paso con una llamada al CLI, para que el contexto y los pasos no crezcan sin necesidad.
start_prompt: /waypoint:work <track>
status: draft
artifact: https://claude.ai/artifact/H4Wr9NBYQgXXeb3fhkW8zA
---

## Contexto

Análisis del 2026-10-13 sobre 21 sesiones con forge (unos 452 $) en `claude-bg-kit`, `reparto` y `reparto-20261012`, con los ficheros de `.forge/usage/`, los JSON de los revisores y los ledgers. Los datos son de forge 0.12–0.13; 0.14.0 ya revisa cada tarea de un plan por el tamaño de su diff real (ver más abajo).

| Bloque | Coste | Por ejecución | Lo que pesa |
|---|---|---|---|
| Sesión principal (Opus xhigh) | 254 $ | — | 65 % lectura de caché: contexto × pasos |
| `forge-impl-heavy` (xhigh) | 75 $ | 3,59 $ | el doble que `forge-impl` (1,61 $) |
| `forge-review-correctness` (xhigh) | 42 $ | 0,87 $ | 54 % escritura de caché, 32 % salida |
| `forge-review-security` (xhigh) | 22 $ | 0,63 $ | |
| `forge-review-perf` (xhigh) | 6 $ | 0,33 $ | ningún hallazgo en ningún fichero conservado |

Hechos que guían el diseño:
- **Sesiones miembro.** En modo `sessions`, la sesión que lleva cada tarea cuesta 2,7–3,9 $ de 4,4–8 $ por tarea (≈45–50 %) y no implementa nada. Se lanza con `claude --bg --name … "<prompt>"`, sin `--model` ni `--effort`, así que hereda Opus xhigh; su contexto medio es de 130–160 k tokens por paso con unos 50 pasos, y carga `forge:run` entero (72 KB) más `waypoint:work` (29 KB).
- **Pocas tareas concentran el gasto.** 19 de 24 tareas se aceptan a la primera. En `campaign-fixes`, las tareas 3 y 4 (cuatro rondas cada una, `impl-heavy` reanudado hasta ~250 k tokens por paso) suman ≈56 $ de 159 $.
- **Rondas que no convergen.** En la tarea 3, seguridad encontró en cada ronda una variante nueva (mayúsculas en el sistema de archivos → nombres cortos 8.3 → `git-common-dir` desde un subdirectorio), mientras correctness pasaba en las cuatro rondas y se volvía a ejecutar entera (~1,1 $ cada vez). En la tarea 4, en cambio, correctness sí encontró en la ronda 2 una regresión del arreglo.
- **Herencia accidental.** `forge-impl-light`, `forge-mech` y `forge-fable` no fijan `effort:`; `impl-light` llegó a correr en Sonnet xhigh (0,35 $ frente a 0,08 $ en medium).
- **El esfuerzo se puede pasar por lanzamiento.** El parámetro `effort` del Agent tool pisa el del agente: verificado en lens con `impl-light` → `low` y `review-perf` (xhigh en su frontmatter) → `high`.
- **El indicador de lens** («sin forge») solo recoge revisores + verificación + seguimiento: los implementadores se recalculan con los mismos tokens al precio del modelo principal, así que bajar su esfuerzo baja la factura pero no ese porcentaje.

Ya resuelto en 0.14.0 y fuera de este trabajo: en una ejecución, cada tarea del plan se dimensiona por su diff real (`triage --base`) y su `review` dice quién la revisa (correctness siempre, security con zona sensible, perf en tareas de rendimiento, una revisión ligera en Sonnet por debajo de Medium). El veredicto lleva las banderas de `review.flags`. Era la propuesta «revisores condicionales en Large».

## Objetivos

- Bajar el coste por tarea en modo `sessions` al menos un 30 % y el de una tarea Medium sensible con varias rondas al menos un 20 %, medidos con los ficheros de lens.
- Que ninguna tarea pierda un bloqueo que hoy tiene: critical, validadores, regresiones del arreglo y la revisión final de Large quedan igual.
- Que el nivel de cada agente se vea en lens (agente y esfuerzo por bucle) para poder auditarlo.

No objetivos: cambiar el modelo o el esfuerzo de la sesión principal de la persona; cambiar el indicador «sin forge» de lens; tocar el planner, el scout ni `forge-verify`.

## Esfuerzo fijo en todos los agentes

Todo agente de forge declara `model` y `effort` en su frontmatter:
- `forge-impl-light`: `effort: medium`.
- `forge-mech`: `effort: low`. Antes de fijarlo se comprueba con un lanzamiento mínimo que lens registra `low` para Haiku; si el modelo no admite esfuerzo, se deja sin él y se anota en el agente.
- `forge-fable`: `effort: high`.

Un test de `tests/plugin.test.ts` falla si un agente de `plugins/forge/agents/` no tiene `model` y `effort`, para que no vuelva a heredar.

Con esto se añade `scripts/usage-report.mjs`: recibe directorios `.forge/usage/` y saca la tabla por agente (modelo, esfuerzo, ejecuciones, pasos, coste medio, reparto salida / lectura / escritura de caché) y el desglose por sesión. Es la herramienta de medida de todo el trabajo: se corre antes y después de cada fase sobre los mismos proyectos.

## Escalera de implementadores

La escalera pasa a cinco peldaños: `mech` → `impl-light` → `impl` (Opus medium) → **`impl-high` (Opus high, nuevo)** → `impl-heavy` (Opus xhigh).

- Nuevo agente `plugins/forge/agents/forge-impl-high.md`: Opus, `effort: high`, `maxTurns: 70`, el mismo texto que los otros implementadores.
- **Dónde empieza cada tarea.** `implementerFor` da `impl-high` (antes `impl-heavy`) a una tarea Medium con zona sensible; en una ejecución, una tarea del plan con zona sensible o marcada como delicada en el diseño empieza en `impl-high`.
- **xhigh solo cuando no hay otro intento.** `decideRound` añade `last: boolean`, verdadero cuando el intento que empieza es el último antes del tope (Medium: la ronda 3; Large: la ronda 4). Con `last`, el implementador de ese intento es `impl-heavy`, venga del peldaño que venga. En las demás rondas, «un peldaño arriba» sigue la escalera.
- **`round` dice a quién lanzar.** `FORGE round` lee del ledger el último implementador de la tarea (eventos `agent` con `role`) e imprime `implementer: {role, agent}` para el siguiente intento, ya resuelto con el perfil. El coordinador deja de calcular la escalera a mano.
- **El arreglo de la revisión final de Large** sigue en `impl-heavy`: es un intento único.
- **Perfiles** (`src/forge/config.ts`):
  - `economy` baja un peldaño: `impl-heavy` → `forge-impl-high`, `impl-high` → `forge-impl`, `impl` → `forge-impl-light`.
  - `quality` sube: `impl` → `forge-impl-heavy`, `impl-high` → `forge-impl-heavy`, `impl-light` → `forge-impl`, `mech` → `forge-impl-light`, `verify` → `forge-verify-heavy` (como hoy).
- **lens** (`src/lens/view.ts`) muestra `forge-impl-high` con su etiqueta `high` y un tono entre `impl` y `heavy`; `heavy` y `fable` corren un rango.

El riesgo es que high necesite más rondas. Se vigila en el informe de consumo y en el ledger (rondas por tarea según el peldaño de salida); si las rondas suben tanto que se come el ahorro, se vuelve a `impl-heavy` para las tareas sensibles con un cambio de una línea en `implementerFor`.

## Esfuerzo de los revisores

`reviewFor` (en `src/forge/triage.ts`) ya devuelve `{role, model, effort}` por revisor. Pasa a rellenar el esfuerzo según el riesgo:

| Revisor | Por defecto | Sube a xhigh cuando |
|---|---|---|
| correctness | high | la tarea es sensible o delicada, y en la revisión final de Large |
| security | high | la zona sensible es `auth` (incluye cripto y secretos) |
| perf | medium | nunca |
| revisión ligera (por debajo de Medium) | Sonnet medium | — (como hoy) |

- El perfil `quality` deja todos los revisores en xhigh; `balanced` y `economy` usan la tabla.
- El frontmatter de los tres revisores baja a `effort: high`: si un lanzamiento olvida el esfuerzo, sale el caso común y no el caro.
- `FORGE triage` imprime `review` también fuera de una ejecución (Medium sin plan), y el paso de revisión de Medium lanza exactamente esos revisores pasando `model` y `effort` al Agent tool, como ya hace la ejecución.

La tabla es provisional hasta el resultado de la prueba en sombra de la sección siguiente: un revisor cuya versión high no pase la regla de decisión vuelve a xhigh por defecto.

## Validación en sombra

La réplica de revisiones históricas no es viable: el worktree de `campaign-fixes` se borró al integrarse y con él casi todas las revisiones que fallaron (sobreviven 2, ninguna de seguridad). La validación se hace sobre trabajo real después del cambio.

- **Arranque.** `FORGE shadow start --tasks <N>` (por defecto 10) abre la prueba en el proyecto y la guarda en `.forge/shadow.json` (`{remaining, cases}`), que es trabajo de forge y no va a git. `FORGE shadow stop` la cierra antes de tiempo.
- **Gemelos.** Mientras quedan tareas, `review-prep` añade a `spawn`, en la primera ronda de cada brief Medium o mayor, un gemelo por cada revisor que salga en high: el mismo agente con `effort: xhigh` y las mismas entradas, que escribe en `<carpeta>/shadow/`.
  - El veredicto solo lee el revisor en high; el gemelo no cuenta.
  - Las rondas `delta` no llevan gemelo.
  - Cada brief resta uno a `remaining`.
- **Comparación.** `review-close` empareja los bloqueantes (critical e important) de cada par:
  - casan si están en el mismo fichero y además a ±10 líneas, o con un solapamiento de palabras del problema ≥ 0,3;
  - el caso se guarda en `.forge/shadow.json` con los bloqueantes de xhigh, los que high recuperó, los críticos perdidos y los bloqueantes que solo encontró high.
- **Informe.** `FORGE shadow report` imprime por revisor: casos, bloqueantes de xhigh, recuperados por high (%), críticos perdidos, bloqueantes solo de high y el detalle de cada caso perdido, para que la persona lo lea.
- **Regla.** high se queda para un revisor si recupera al menos el 90 % de los bloqueantes de su gemelo y no pierde ningún critical. Si no, ese revisor vuelve a xhigh por defecto (una línea en `reviewFor`). La decisión la toma la persona al ver el informe.
- **Coste:** un gemelo por revisor en high durante N briefs, unos 0,9 $ por brief (≈10 $ con N = 10).

## Rondas de arreglo

Desde la ronda 2, la revisión mira el arreglo, no la tarea entera otra vez.

**Entradas de la ronda.** Cada ronda guarda el commit que revisó (`head.txt` en su carpeta de revisiones). Desde la ronda 2 se preparan:
- `fix-<n>-<ronda>.patch`: el diff entre el commit revisado en la ronda anterior y el actual;
- los hallazgos bloqueantes de la ronda anterior, por revisor.

**Quién revisa y cómo.**
- Un revisor que falló en la ronda anterior repite en modo `delta`: recibe el brief, el diff completo como contexto, el diff del arreglo y solo sus propios hallazgos anteriores (los revisores siguen sin ver los de los demás). Comprueba que están arreglados y que el arreglo no rompe nada.
- correctness repite siempre en `delta`, también si pasó: el arreglo de otro revisor puede romper algo (lo que pasó en la tarea 4).
- security o perf que pasaron solo repiten si el arreglo toca su terreno (security: el diff del arreglo toca una zona sensible). Si no, su resultado anterior se copia a la carpeta de la ronda con `"carried": true` y el veredicto lo cuenta como en la ronda anterior.

**Origen de cada hallazgo.** En modo `delta`, cada hallazgo lleva `origin`:
- `previous`: un hallazgo anterior sin arreglar;
- `fix`: lo introduce el arreglo;
- `untouched`: está en código que el arreglo no tocó.

El CLI comprueba la etiqueta: un `untouched` cuyo fichero y línea caen dentro de un trozo del diff del arreglo pasa a `fix`, y un hallazgo sin fichero o sin línea nunca cuenta como `untouched`.

**Convergencia: se sube al carro.** Desde la ronda 2, un hallazgo `important` con `origin: untouched` no abre una ronda por sí solo.
- Si la ronda se abre por otro motivo (un `previous`, un `fix`, un validador en rojo o un `critical`), va en los hallazgos que recibe el implementador sin coste extra.
- Si es lo único pendiente, la tarea se acepta y el hallazgo queda como `deferred`: el skill lo registra como ruling y lo lista en el informe para que la persona decida.
- Un `critical` bloquea siempre, sea cual sea su origen.

En la puntuación, una revisión cuyos únicos bloqueantes son `deferred` cuenta como pase con su confianza. La firma de `stalled` ignora los `deferred`.

Alternativa descartada (propuesta por la persona): abrir otra ronda subiendo el implementador mientras quede peldaño y pasar a ruling solo en el tope. Con la escalera nueva casi siempre queda peldaño, así que se comportaría como hoy. Y el hallazgo no es algo que el implementador no supiera arreglar, sino algo que la revisión anterior no vio, así que subir de nivel no ataca la causa.

**Dónde vive.** En `src/forge/verdict.ts` (`origin` en `Finding`, `synthesize` con la ronda y los trozos del arreglo, la lista `deferred`), en el texto de los tres revisores (modo `delta`) y en dos comandos nuevos:
- `FORGE review-prep --task <id>-<n> --path <p> --base <sha> --baseline <f> --dir <carpeta> [--cwd <worktree>] [--locale]`: valida contra la línea base y escribe `validators-<n>.json`; escribe el diff y, desde la ronda 2, el diff del arreglo y los hallazgos anteriores; calcula quién revisa (`review` del triage + las reglas de arriba) y copia los resultados arrastrados; guarda `head.txt` y `review-plan.json`. Imprime un JSON corto con `round`, el resumen de validadores y `spawn: [{agent, model, effort, mode, inputs}]`. `verify-plan` sigue siendo un paso aparte porque puede preguntar a la persona.
- `FORGE review-close --task <id>-<n> --dir <carpeta> --path <p>`: comprueba que cada revisor lanzado dejó su fichero (sale con código 3 y `missing` si falta alguno), corre el veredicto con las banderas de `review-plan.json` y la ronda, registra los menores y los `deferred` como rulings y escribe `findings-<n>-<ronda>.json` (lo que recibe el implementador). Imprime `{action, score, next, last, implementer, findings, deferred, invalid}`.

`FORGE verdict` y `FORGE round` siguen existiendo; los dos comandos nuevos los usan por dentro.

## Sesiones miembro

**Lanzamiento con esfuerzo propio.** La configuración gana `swarm.member: {effort, model}`:
- `effort` es `low | medium | high | xhigh | max` y por defecto `medium`;
- `model` es opcional; sin él, la sesión usa el modelo por defecto de la persona.

`waypoint launch --task` acepta `--effort <e>` y `--model <m>` (validados contra una lista cerrada) y los pone en `command` y en `run`: `claude --bg --name <N> --effort medium "<prompt>"`. Para que el coordinador no componga argumentos:
- la acción `start` de `FORGE swarm tick` imprime `launch`, la lista de argumentos completa;
- `FORGE swarm relaunch` añade esos flags a la `launch` que ya imprime.

**Un skill a su medida.** Nuevo skill `forge:member` con solo lo que necesita una sesión miembro:
- las reglas comunes (idioma, editar con Edit/Write, decisiones desatendidas);
- el alta de la sesión (los pasos 1–4 del setup de `waypoint:work`, resumidos), `join`, el relevo, el reclamo y el cierre;
- para los pasos de la tarea, remite a `plugins/forge/skills/run/references/task-steps.md`.

Ese fichero se extrae de «A task's steps» de `forge:run`, que también lo usa.

- El prompt de lanzamiento pasa a ser `/forge:member --plan <plan> --task <T> — run member of <SID>: work only <T>, then stop`.
- El texto de reanudación de `src/forge/live.ts` apunta a `/forge:member`.
- `forge:run` mantiene una línea de compatibilidad: un prompt antiguo `/forge:run --plan … — run member of …` sigue `forge:member`.

Objetivo medible: el coste de la sesión miembro por tarea baja de ~3 $ a menos de 1,5 $ sin más bloqueos ni relanzamientos por tarea (ledger y `swarm status`).

## Coordinador

El coordinador paga cada paso con todo su contexto: con unos 450 k tokens, cada llamada cuesta ~0,09 $ solo en lectura de caché.

**Menos pasos.**
- Medium y las tareas de una ejecución usan `review-prep` y `review-close` en lugar de validar, sacar el diff, revisar, veredicto y ronda por separado.
- `FORGE prep --task <id>-<n> --path <p> [--cwd]` registra `BASE`, la fase y la línea base en una sola llamada e imprime `BASE`.
- En una ejecución, cada cambio de etapa se publica con un único `batch` de ArtifactData: `state/T.exec`, `state/T.forge` y el arrendamiento de `sessions/<SID>` juntos, en vez de llamadas sueltas.

**Menos texto cargado.** `plugins/forge/skills/run/SKILL.md` se parte en un núcleo de como mucho 25 KB y referencias que se leen al tomar cada camino:
- **Núcleo:** encabezado, idioma, ids, reglas comunes, resumen de decisiones y autonomía, triaje, Trivial, Small y Medium.
- **Referencias en `references/`:**
  - `large.md`, `execution.md`, `task-steps.md`, `ephemeral.md`;
  - `superpowers-plan.md`, `manual-member.md`, `resuming.md`;
  - `autonomy.md` (la tabla completa) y `decisions.md` (formato completo).

Cada camino del núcleo empieza con «Lee ahora `references/<fichero>.md`». Los tests de `tests/plugin.test.ts` leen el fichero donde ahora vive cada texto, comprueban que toda referencia citada existe y que el núcleo no pasa de 25 KB.

## Fases

El orden es el que pidió la persona:
1. **Esfuerzo fijo.** Agentes con `effort`, el test que lo exige y `scripts/usage-report.mjs`. Se mide la línea base con el informe.
2. **Sesiones miembro.** `swarm.member`, flags de `waypoint launch`, `launch` en `tick` y `relaunch`, `forge:member` y `references/task-steps.md`.
3. **Escalón `impl-high`.** Agente, escalera, `last` en `round`, `implementer` en la salida de `round`, perfiles y lens.
4. **Revisores y rondas.** Tabla de esfuerzo, `review` en todo triage, modo `delta`, `origin`, convergencia, `review-prep`, `review-close` y la prueba en sombra (`FORGE shadow`). Al acabar, se abre la prueba en este repositorio y los valores se fijan con su informe.
5. **Coordinador.** `FORGE prep`, el `batch` por etapa y el `SKILL.md` partido.

Cierre: forge 0.15.0, waypoint 0.19.0 (flags nuevos en `launch`) y lens 0.11.3; `CHANGELOG.md` y los README (es/en) con lo que cambia para la persona; bundles regenerados con `npm run build`.

## Medición y éxito

- **Antes:** el informe de `scripts/usage-report.mjs` sobre los ficheros actuales (los datos de la sección Contexto).
- **Después:** la misma tabla sobre las siguientes ejecuciones reales (una Medium sensible y una ejecución en modo `sessions` de al menos 4 tareas).
- **Éxito:**
  - coste por tarea en `sessions` −30 %;
  - una Medium sensible con varias rondas −20 %;
  - las rondas por tarea no suben más de 0,3 de media;
  - ningún critical de la prueba en sombra se pierde.
- Si una medida no cumple, se revierte esa pieza (cada fase tiene sus commits) y se documenta por qué en este diseño.

## Riesgos

- **high en implementadores pide más rondas.** Mitigación: el último intento siempre en xhigh, la medida de rondas por tarea y la vuelta atrás de una línea en `implementerFor`.
- **La revisión `delta` deja pasar una regresión fuera del arreglo.** Mitigación: correctness repite siempre con el diff completo como contexto, y la revisión final de Large sigue siendo completa.
- **La convergencia deja problemas reales como rulings.** Mitigación: salen en el informe de cierre con su fichero y línea para que la persona decida, y un `critical` bloquea siempre.
- **Una sesión miembro en medium sigue peor el protocolo.** Mitigación: el skill reducido; `swarm.member.effort` sube a `high` sin tocar código; la medida de bloqueos y relanzamientos.
- **Al partir `SKILL.md`, el modelo no lee la referencia.** Mitigación: cada camino abre con la orden de leerla, y un paso que necesite un comando de la referencia lo nombra en el núcleo.
- **Ejecuciones en curso con prompts antiguos.** Mitigación: la línea de compatibilidad de `forge:run` y `live.ts`.
