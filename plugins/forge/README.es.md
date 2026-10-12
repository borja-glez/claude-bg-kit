<div align="center">

# 🔨 forge

**Una forma de trabajar adaptativa para Claude Code.**
Triaje por tamaño, el modelo adecuado para cada papel, primero tus propias herramientas, revisión independiente ponderada, y ejecuciones en paralelo o desatendidas cuando el trabajo es grande.

[English](README.md) · **Español** · [← bg-kit](../../README.es.md)

![versión 0.7.0](https://img.shields.io/badge/versi%C3%B3n-0.7.0-fab387?style=flat-square)
![depende de waypoint ^0.12.0](https://img.shields.io/badge/depende%20de-waypoint%20%5E0.12.0-cba6f7?style=flat-square)

</div>

<p align="center"><img src="../../docs/assets/paths.es.svg" alt="El triaje de forge lleva una tarea al camino Trivial, Small, Medium o Large; debajo, la escalera de implementadores y los tres revisores" width="100%"></p>

## Contenido

- [Por qué forge](#por-qué-forge)
- [Instalación](#instalación)
- [Uso](#uso)
- [Caminos](#caminos)
- [Agentes](#agentes)
- [El camino Large](#el-camino-large)
- [Modos de ejecución](#modos-de-ejecución)
- [Modo infinito](#modo-infinito)
- [Propuestas](#propuestas)
- [Verificación](#verificación)
- [Configuración](#configuración)
- [Referencia de la CLI](#referencia-de-la-cli)

## Por qué forge

Hacer todas las tareas igual malgasta esfuerzo. Una revisión completa de un arreglo de una línea cuesta más de lo que ahorra, y un cambio grande sin revisión rompe cosas. forge mide cada tarea primero y gasta en proporción:

- **Proporcionado.** El trabajo trivial se queda en la sesión principal. Solo el trabajo Medium y Large paga revisión independiente.
- **Herramientas antes que opiniones.** Tus tests, linters, comprobador de tipos y build se ejecutan antes de que ningún revisor lea el diff.
- **Revisión independiente.** Los revisores son agentes aparte que no escribieron el código. Lo juzgan contra el brief y devuelven veredictos con nota, y forge los pondera en una decisión.
- **El modelo adecuado para cada papel.** El trabajo mecánico va a Haiku; el delicado, a Opus con esfuerzo muy alto.
- **Escala.** Los planes grandes se ejecutan como una ejecución de tareas en paralelo, y el modo infinito sigue mejorando el proyecto dentro de un presupuesto.

## Instalación

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install forge@bg-kit
```

forge depende de [waypoint](../waypoint/README.es.md) ^0.12.0, que se instala con él. [lens](../lens/README.es.md) es opcional y recomendable. Reinicia Claude Code después de instalar o actualizar. Permiso recomendado: `Bash(node *forge.cjs*)`.

## Uso

| Comando | Qué hace |
| --- | --- |
| `/forge:run <tarea>` | Hace el triaje de la tarea y la trabaja por el camino que pide su tamaño. |
| `/forge:run --parallel N <tarea>` | Lo mismo, ejecutando hasta N tareas a la vez en el camino Large (3 por defecto, máximo 10). |
| `/forge:infinite [--cycles N] [--hours H]` | Ciclos de mejora desatendidos dentro de un presupuesto. |
| `/forge:decide <id> approve\|reject\|comment <texto>` | Decide o comenta una propuesta desde cualquier sesión. |
| `/forge:verify [superficie]` | Comprueba el trabajo usándolo (web, emulador, CLI...), o crea y edita superficies de verificación. |
| `/forge:stop` | Para la ejecución infinita o la ejecución en paralelo. |

```text
/forge:run Corrige el error por uno en la paginación      → Trivial o Small
/forge:run Añade límite de peticiones a la API pública     → Medium: plan corto, implementador, validadores, revisión
/forge:run Rehaz el checkout con soporte multimoneda       → Large: diseño, plan, roadmap y luego cada tarea
```

## Caminos

| Camino | Puerta | Ejecutor | Validación | Revisión |
| --- | --- | --- | --- | --- |
| **Trivial** | ninguna | la sesión principal | validadores del fichero cambiado | ninguna |
| **Small** | ninguna | sesión principal, `impl-light` o `mech` | todos los validadores + leer el diff | ninguna |
| **Medium** | plan corto, sigue salvo que lo pares | `impl` / `impl-heavy` | todos los validadores | correctness (+ security si es sensible) |
| **Large** | aprobación obligatoria del diseño | `/waypoint:design`, `/waypoint:plan` y luego el bucle Medium por tarea | todos los validadores | correctness + security + perf, y revisión final de toda la rama |

El triaje lee el texto de la tarea, los ficheros que probablemente toque y las zonas sensibles (auth, datos y migraciones, API pública, dependencias, CI), y elige los validadores que aplican.

**El bucle de revisión.** Los revisores escriben veredictos en JSON. `forge verdict` los pondera en una nota, y `forge round` decide el siguiente paso: `done`, `resume` (arreglar con el mismo implementador), `fresh-stronger` (un implementador nuevo, un nivel más arriba), `redo`, `breaker` o `stalled`. Desde la ronda 3 sube de nivel, y las tareas Large tienen hasta 4 rondas.

## Agentes

| Agente | Modelo | Esfuerzo | Uso |
| --- | --- | --- | --- |
| `forge-mech` | Haiku | por defecto | trabajo mecánico: renombrados, datos, código ya escrito, builds |
| `forge-impl-light` | Sonnet | por defecto | cambios pequeños y acotados |
| `forge-impl` | Opus | medio | implementación media e investigación |
| `forge-impl-heavy` | Opus | muy alto | implementación importante o delicada |
| `forge-fable` | Fable | por defecto | solo cuando lo pides expresamente |
| `forge-review-correctness` | Opus | muy alto | revisión de corrección |
| `forge-review-security` | Opus | muy alto | revisión de seguridad |
| `forge-review-perf` | Opus | muy alto | revisión de rendimiento |
| `forge-verify` | Sonnet | alto | usa el trabajo a través de una superficie e informa con pruebas (`forge-verify-heavy`, Opus, también alto, con el perfil `quality`) |
| `forge-planner` | Opus | muy alto | camino Large: convierte un diseño aprobado en un plan de waypoint |
| `forge-scout` | Opus | medio | modo infinito: propuestas de mejora con pruebas |

Los implementadores escriben su informe en `report-<n>.txt` y también lo incluyen en su respuesta. El perfil `economy` baja un nivel a los implementadores y `quality` los sube; los revisores nunca cambian.

## El camino Large

1. `/forge:run` ejecuta `/waypoint:design` y **espera a que apruebes el diseño**.
2. `forge-planner` escribe `plan.yaml` y `/waypoint:plan` publica el roadmap vivo.
3. `/waypoint:work` reclama cada tarea, y su paso «hacer el trabajo» se convierte en el bucle de forge: `brief --plan`, `triage --plan`, un implementador, los validadores y los tres revisores, durante hasta 4 rondas.
4. Al acabar las tareas, `review-correctness` revisa toda la rama contra el diseño y el plan, con como mucho un arreglo y una segunda revisión. La segunda revisión recibe validadores y diff nuevos, y un veredicto `redo` se trata como un arreglo.

La base de la ejecución se guarda en `.forge/work/<proyecto>/run.json`, que se escribe una vez tras aprobar el diseño. Mientras una tarea corre, la coordinadora renueva una concesión (`leaseUntil`, 10 minutos) en el estado de la tarea y en su propia sesión de waypoint, para que las sesiones en paralelo no le quiten una tarea que sigue en marcha. Además de la concesión, la coordinadora deja una señal local en `.forge/live/` (mira [Señal en vivo](#señal-en-vivo)).

## Modos de ejecución

<p align="center"><img src="../../docs/assets/swarm.es.svg" alt="Una coordinadora en la rama de ejecución forge/run-<proyecto> lanza un subagente implementador por tarea lista, cada uno en su worktree de tarea; las tareas se integran en la rama de ejecución de una en una y se fusionan en tu rama al final" width="100%"></p>

En el camino Large y en el modo infinito, forge ejecuta las tareas del plan con **un planificador** que trabaja por tareas: `forge swarm tick` decide qué tareas están listas (sus dependencias están integradas y sus zonas no se solapan) y qué trabajo terminado integrar, hasta `swarm.parallel` a la vez. Hay dos modos:

- **subagents** (el de por defecto). La sesión coordinadora trabaja cada tarea con subagentes en un worktree de git propio.
- **sessions** (aún no disponible: llega en la versión siguiente). Cada tarea correría en su propia sesión en segundo plano. Hasta entonces, pedirlo cae a subagents.

La ejecución secuencial no es un tercer modo: es subagents con N = 1.

**Cómo se elige el modo.** forge propone uno (`forge swarm propose --plan <plan>` dice cuán ancho es el plan y recomienda un modo y una N), o lo dices tú («en enjambre», «con subagentes», «en paralelo», «secuencial»), o lo fijas con `swarm.mode` en `.forge/config.yaml`. N es tu `--parallel N` si lo das, y si no la recomendación, con el tope de `swarm.parallel`.

**La rama de ejecución.** Una ejecución trabaja en `forge/run-<proyecto>`, en el worktree `.claude/worktrees/run`. Abre la app desde ahí para ver el trabajo de la ejecución según crece. Tu checkout no se toca hasta la fusión final, que te pide permiso o usa el que diste al empezar (`--merge-on-finish`). `swarm start` rechaza la rama por defecto como `--branch`, y nunca hace push.

**Worktrees por tarea.** Cada tarea tiene `.claude/worktrees/task-<tarea>` en la rama `task/<tarea>` (`forge swarm worktree <tarea>`). Nada más crear un worktree, forge instala sus dependencias con `swarm.setup` de `.forge/config.yaml`. Sin él, el comando se deduce del lockfile: `npm ci` para `package-lock.json`, `pnpm install --frozen-lockfile` para `pnpm-lock.yaml`, `yarn install --frozen-lockfile` para `yarn.lock`. Un `.venv` de Python no tiene un valor por defecto seguro: pon `swarm.setup`. El resultado (su comando y las últimas líneas de salida) se te enseña, y una instalación fallida nunca para la ejecución.

**Integración.** Una tarea terminada se fusiona en la rama de ejecución con `forge swarm integrate <tarea>`, de un merge en uno, pasando los validadores tras cada uno. Los fallos que **ya existían** en la rama de ejecución no bloquean: los validadores se comparan con una base guardada por ámbito, destino y commit en `.forge/execution/baseline/`, y solo los fallos nuevos deshacen el merge (un conflicto también). El `forge swarm merge` final a tu rama hace lo mismo y responde `merged`, `needs-authorization`, `main-dirty` o `conflict`.

**Parar.** `/forge:stop` (o `forge stop`) termina la ejecución: la coordinadora ve la parada y acaba su paso, y una ejecución cuya sesión ya no existe se cierra igualmente. Tras una parada por un conflicto o una tarea bloqueada, `forge swarm retry <tarea>` reactiva la ejecución sin volver a lanzar `/forge:run`.

**Estado y visibilidad.** El estado vive en `.forge/execution/` (la ejecución y un fichero por tarea) y se refleja en el `meta/run` del roadmap. Lo enseñan el roadmap, lens y la banda: una fila por tarea en marcha con su etapa, agente, duración y vida.

### Señal en vivo

`forge hook live` se ejecuta en SessionStart, SessionEnd, SubagentStart, SubagentStop y Stop. Para la coordinadora de una ejecución activa escribe `.forge/live/<sessionId>.json` en el checkout principal, con el último evento, la hora y los subagentes en marcha. lens, la banda y el roadmap lo leen: una sesión se muestra **sin señal** tras 7 minutos sin eventos y **parada** tras 12. Los subagentes que empezaron hace más de 3 horas se descartan. El hook no imprime nada y nunca falla.

## Modo infinito

`/forge:infinite [--cycles N] [--hours H]` necesita un diseño de waypoint aprobado, un plan y un presupuesto. Si no le das presupuesto, lo pregunta una vez, y `forge infinite start` se niega a arrancar sin `--cycles` o `--hours`. Ejecuta `forge infinite start`, escribe `meta/infinite` en el roadmap y termina el turno. El primer hook Stop une esa sesión a la ejecución, así que usa una sola sesión por checkout.

**En cada ciclo** forge:

1. trae las decisiones del roadmap;
2. convierte las propuestas aprobadas en tareas del plan (`proposals to-task`);
3. trabaja una tarea con `/forge:run` dentro de `/waypoint:work`. Una tarea clasificada como Large no se diseña sin ti: queda bloqueada con una pregunta para ti, y la ejecución sigue;
4. cuando `waypoint next` no encuentra tarea, o cada 3 ciclos, lanza `forge-scout` para escribir propuestas nuevas (`proposals add`, `proposals policy`);
5. registra el ciclo con `forge cycle --progress yes|no`.

**Política.** Solo se autoaprueban las propuestas de bajo riesgo y verificables: un arreglo de tests, deuda de calidad pequeña, rendimiento con un benchmark en las pruebas o seguridad con un test en las pruebas. Las funcionalidades, las dependencias, la arquitectura y cualquier riesgo medio o alto te esperan (en el roadmap, en lens o con `/forge:decide`). Una propuesta parecida a otra rechazada se descarta salvo que traiga pruebas nuevas. Una parecida a otra abierta se descarta siempre; una v2 nombra la propuesta que revisa con `--revises`. **No se integra nada en main ni se hace push sin tu autorización.**

**Condiciones de parada:**

- existe el fichero `.forge/stop`;
- se agota el presupuesto (ciclos u horas);
- 3 ciclos seguidos sin progreso;
- el mismo error dos veces seguidas;
- el hook Stop bloqueó dos veces sin un ciclo registrado;
- no hay nada aprobado y la cola de pendientes está llena.

Cuando aparece una condición de parada por primera vez, el hook Stop marca la ejecución como inactiva y bloquea una vez, para que la sesión la cierre: apaga `meta/infinite` e informa. Una ejecución inactiva no vuelve a bloquear. `/forge:stop` marca la ejecución como inactiva por sí mismo, así que se puede parar una ejecución cuya sesión ya no existe y empezar otra. Una ejecución que se queda en reposo se reanuda cuando termina el siguiente turno de su sesión. El hook Stop de waypoint convive con el de forge, que solo bloquea mientras `run.json` está activo.

## Propuestas

Una propuesta es un documento con estos campos:

```json
{ "ts": "…", "category": "perf", "risk": "low", "title": "…", "rationale": "…", "evidence": "…",
  "pillar": "…", "estimate": "…", "path": "small", "status": "proposed", "source": "scout", "author": "…" }
```

| Campo | Valores |
| --- | --- |
| `category` | feature, security, perf, quality, tests, deps |
| `risk` | low, medium, high |
| `status` | proposed, discussing, approved, auto_approved, rejected, done |
| `source` | scout, user |

Solo se pueden decidir las propuestas `proposed` y `discussing`, y solo las decides tú (en la página del roadmap o con `/forge:decide`). Las sesiones solo crean propuestas y las comentan. Hay una copia local en `.forge/proposals/<id>.json`; la base de datos del roadmap manda en los campos de la decisión (`proposals pull`).

`/forge:decide` funciona desde cualquier sesión, incluso sin roadmap. En ese caso solo cambian la copia local y el registro, y el siguiente `proposals pull` sustituye la decisión local por el estado del roadmap. Con `--from <doc json de la db>`, la CLI comprueba la decisión contra ese documento y no registra nada. Cuando la actualización del roadmap sale bien, `/forge:decide` guarda el documento actualizado con `proposals save --from`, así que una escritura fallida o rechazada en el roadmap nunca deja una decisión local suelta.

Mientras forge trabaja una tarea de waypoint, también escribe un pequeño bloque `forge` (camino, fase, agente, validadores, veredicto, ronda) en el documento `state/T` de la tarea, que enseñan el roadmap y lens.

## Verificación

Los tests y los revisores leen el código; la verificación **usa** el resultado. Una **superficie** es algo del proyecto que se puede comprobar usándolo: una web, una app en un emulador, un dispositivo simulado, una CLI, una app de escritorio. No tiene tipo: es un fichero Markdown en `.forge/verify/<nombre>.md` que cuenta en texto libre cómo se arranca y cómo se prueba.

**Las superficies aparecen de tres formas:**

- **Por chat.** Cuéntale a la sesión cómo comprobar algo («arranca el emulador, empareja la báscula, pesa») y escribe el fichero por ti, sin preguntar.
- **Por detección.** forge reconoce una web, un proyecto Android o Flutter y similares, y propone un borrador de superficie para que lo aceptes.
- **Por experiencia.** `forge-verify` añade lo que aprende (un primer arranque lento, un ajuste que hay que activar) a la sección `Aprendido` de la superficie, así que la siguiente vez empieza sabiendo más.

**Cuándo se ejecuta.** En tareas Medium y Large, cuando el diff toca los globs `affects` de una superficie. Una superficie sin `affects` es siempre candidata y decide la sesión. En tareas Trivial y Small solo se ejecuta cuando la tarea lo pide. Una superficie solo se ejecuta si la has permitido (ver Configuración).

**El agente.** `forge-verify` (Sonnet; `forge-verify-heavy` en Opus con el perfil `quality`) arranca la superficie, prueba el flujo principal de la tarea y escribe `verify.json` y capturas en `.forge/work/<id>/`. Corre en paralelo con los revisores, y sus fallos cuentan en el veredicto como los de un revisor. Nunca edita ficheros del proyecto, nunca hace commit, push ni merge, y nunca instala dependencias del proyecto. `verify.limits` acota cuántas comprobaciones, capturas y minutos gasta.

**Pruebas en el roadmap.** Con `evidence: upload` (el valor por defecto) las capturas se suben al roadmap y aparecen en el detalle de la tarea. Subirlas hace que el roadmap sea **interno de la organización**, así que ya no se puede compartir públicamente; forge te lo avisa una vez. Con `evidence: local` no se sube nada y el roadmap sigue pudiendo compartirse públicamente. En ambos casos las pruebas quedan en `.forge/work/`.

## Configuración

`.forge/` en el proyecto contiene `config.yaml`, `verify/` (las superficies), el registro, `local.yaml`, `status.json`, `work/<id-de-tarea>/` (briefs, diffs, informes, revisiones, pruebas de verificación), `proposals/`, `run.json`, `execution/` (la ejecución y sus bases), `live/` (la señal local) y `usage/`. Git ignora todo lo que hay dentro salvo `config.yaml` y `verify/*.md`.

```yaml
profile: balanced              # balanced | economy | quality
detect: true                   # por defecto true
exclude: [build]               # validadores detectados que no quieres, por nombre
validators:                    # manuales
  - name: unit
    cmd: npm test
    kind: test                 # letras, dígitos y _ . : -
    affects: ["src/**", "test/**"]
  - name: a11y
    cmd: npm run a11y
    kind: a11y
    when: medium               # opcional: always | medium | final
verify:
  limits: { checks: 8, shots: 10, minutes: 10 }   # opcional; estos son los valores por defecto
evidence: upload               # upload | local; por defecto upload
validatorTimeoutSec: 600
swarm:
  parallel: 3                  # tareas a la vez; 1 ejecuta una cada vez; máximo 10
  mode: subagents              # opcional: subagents | sessions (sessions llega en la versión siguiente)
  setup: npm ci                # opcional: instala las dependencias de un worktree nuevo; por defecto se deduce del lockfile
  launcher: bg                 # bg | herdr; por defecto bg
```

`swarm.setup` es un comando de hasta 500 caracteres, que se ejecuta en cada worktree que crea forge. `.forge/config.yaml` es el único fichero de `.forge/` que git sí versiona, así que un `setup` que commitees vale para todo el que ejecute el proyecto.

> **Cambio en 0.6.0:** una lista `validators` en `.forge/config.yaml` ya no desactiva la detección; también se usan los validadores detectados, y los tuyos ganan por nombre. Pon `detect: false` para el comportamiento anterior.

**Validadores.** Con `detect: true` (el valor por defecto), forge detecta las herramientas del proyecto y mezcla tu lista `validators` con ellas; un validador manual sustituye a uno detectado con el mismo nombre, y `exclude` quita los detectados por nombre. Con `detect: false` solo se ejecuta la lista, y `validators: []` significa ninguno.

- `kind` es cualquier nombre hecho de letras, dígitos y `_ . : -` (`test`, `lint`, `e2e`, `a11y`...). `when` dice cuándo se ejecuta un validador: `always`, `medium` (tareas Medium y Large y la revisión final) o `final` (solo la revisión final de una ejecución Large). Un `kind` que forge no conoce vale `medium` por defecto.
- `verify.limits` admite como máximo `checks: 20`, `shots: 30` y `minutes: 60`.
- `evidence` es `upload` o `local`, como se describe en [Verificación](#verificación).

**Las superficies** viven en `.forge/verify/<nombre>.md`: una cabecera opcional (globs `affects` que hacen candidata a la superficie, y las `tools` que usa), instrucciones en texto libre y notas bajo `## Aprendido`.

```markdown
---
affects: ["src/ble/**", "src/devices/**"]
tools: [adb, chrome-mcp]
---
# Báscula Bluetooth

Arranca el emulador Pixel_7 y la app con `npx cap run android`.
La báscula se simula con `node tools/fake-scale.js` (anuncia "SCALE-01").
Empareja desde Ajustes > Dispositivos y pesa: debe salir el peso en la pantalla principal.

## Aprendido
- 2026-10-14: el emparejamiento falla si el emulador no tiene Bluetooth activado: `adb shell svc bluetooth enable`.
- 2026-10-15: la app tarda unos 40 s en arrancar la primera vez.
```

**Permisos.** `.forge/local.yaml` (fuera de git) guarda tu permiso o prohibición por superficie, y la primera vez que una superficie fuera a ejecutarse, la sesión te pregunta. El permiso queda ligado al contenido del fichero (un hash del fichero entero): si alguien edita la superficie, por ejemplo en un commit o una PR, vuelve a preguntar y te enseña qué cambió. forge vuelve a firmar sus propias notas de `Aprendido`, así que esas nunca provocan la pregunta, pero las líneas que añada cualquier otra persona sí.

**Coincidencias.**

- `affects` es una lista de globs sobre rutas relativas al repo con separadores `/`. `*` casa dentro de un segmento de la ruta y `**` atraviesa segmentos (`src/**`, `web/*.ts`); no se admite otra sintaxis de glob.
- Un validador con `affects` solo se ejecuta en `validate --affected` si casa alguna de las rutas cambiadas. Sin `affects`, se ejecuta siempre.
- Qué validadores se ejecutan depende del tipo y del momento: `test`, `lint`, `typecheck` y `other` se ejecutan siempre; `build` se salta con `--affected`; `e2e` solo se ejecuta en tareas Medium y Large cuando sus `affects` casan con el diff (o no tiene), y en la revisión final; `bench` solo en la revisión final. Un tipo que forge no conoce se ejecuta en tareas Medium y Large y en la revisión final. El `when` de un validador manda sobre todo esto. Por eso `--all` no ejecuta todos los validadores.

## Referencia de la CLI

Se ejecuta como `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs" <comando>`.

<details>
<summary><b>Tareas y revisión</b></summary>

- `triage [--task id] (<texto> | --text-file f)` - clasifica una tarea: camino, ficheros, zonas sensibles y validadores. `--text-file` lee el texto de un fichero, para que nunca pase por un shell.
- `triage --plan p --task T` - hace el triaje de una tarea del plan a partir de sus zonas y su `done_when`.
- `brief --plan p --task T [--design d]` - imprime el brief de una tarea del plan de waypoint, con la línea `Commit title prefix` que usan los implementadores.
- `validate [--affected a,b | --all] [--path trivial|small|medium|large] [--base sha] [--final] [--task id] [--base-run | --baseline f]` - ejecuta los validadores del proyecto que tocan (ver Coincidencias); `--base` da el diff contra el que se casan los `affects` de e2e, `--final` elige el conjunto de la revisión final. `--base-run` marca una ejecución sobre el commit base, antes de cualquier cambio; `--baseline f` toma el JSON de esa ejecución y marca `preexisting` un fallo que la base ya tenía, que no cuenta ni en el código de salida ni en el veredicto. Un runner de tests que no encuentra tests pasa como `skipped: "no-tests"`.
- `verdict --task id --dir d [--validators f] [--sensitive] [--perf]` - pondera los JSON de los revisores en una nota. Un revisor aparece con `invalid: true` si su salida no servía (`dropped: 0`, cuenta como abstención) o si se descartaron algunos de sus hallazgos (`dropped` > 0; la revisión mantiene su veredicto y puntúa, y la skill registra los hallazgos descartados como resolución).
- `round --task id --path medium|large` - decide el siguiente paso del bucle de revisión (`done`, `resume`, `fresh-stronger`, `redo`, `breaker`, `stalled`; `tierUp` desde la ronda 3).
- `log --kind k [--task id] [--data json | --data-file f]` - añade una entrada al registro.
- `last --task id` - el camino, el último evento de fase, el último veredicto y la última ronda de una tarea.
- `agents` - los nombres de los agentes del perfil activo.
- `surfaces [learn --name N --notes-file F [--heading H] | proposed --name N]` - lista las superficies y los borradores detectados; añade notas a la sección `Aprendido` de una superficie; marca un borrador como propuesto.
- `tools [--surface N]` - comprueba cuáles de las herramientas que lista una superficie están en el PATH.
- `local get [surfaces.<nombre>] | set surfaces.<nombre> allowed|denied|none` - lee o escribe los permisos de las superficies en `.forge/local.yaml`.
- `verify-plan --task id --path p --base sha [--asked]` - decide si se verifica y qué superficies son candidatas.
- `verify-cleanup --dir d` - detiene los procesos que dejó `forge-verify` (según `pids.json`).
- `waypoint-cli` - imprime la ruta absoluta del `waypoint.cjs` de waypoint (el de mayor versión junto a este plugin); sale con 2 si no lo encuentra.

</details>

<details>
<summary><b>Propuestas</b></summary>

- `proposals add --file f [--author a]` - crea una propuesta local (id `p` + marca de tiempo + 4 caracteres); `--author` tiene prioridad sobre el `author` del fichero.
- `proposals list [--status s]`
- `proposals decide <id> approve|reject|discuss [--reason-file f] [--by quién]` - decide la copia local, lo registra e imprime la escritura para el roadmap. Con `--from <doc json de la db>` solo comprueba ese documento e imprime la escritura.
- `proposals save --from <doc json de la db> [--id id]` - guarda un documento del roadmap como copia local y registra la decisión si cambió su estado.
- `proposals pull --dir d` - refresca la copia local desde los documentos `proposals` del roadmap.
- `proposals policy`, `proposals to-task` - autoaprobación y conversión de propuestas aprobadas en tareas del plan.

</details>

<details>
<summary><b>Modo infinito y ejecución</b></summary>

- `infinite start --cycles N | --hours H`, `infinite status`, `cycle --progress yes|no`, `stop`
- `swarm start --project P --session SID [--mode subagents|sessions] [--parallel N] [--merge-on-finish] [--branch B] [--kind plan|ephemeral]` - empieza o reanuda una ejecución; crea la rama de ejecución y su worktree e imprime el resultado de `setup`. Ejecútalo desde el checkout principal.
- `swarm status` - el estado de la ejecución, por tarea.
- `swarm propose --plan p` - el ancho del plan y el modo y la N recomendados.
- `swarm worktree <tarea>` - crea el worktree y la rama de la tarea (y ejecuta `swarm.setup`).
- `swarm task <tarea> --stage S [--agent A | --no-agent] [--round N] [--status running|accepted|blocked] [--detail-file F] [--lease ISO]` - anota la etapa, el agente y la ronda de la tarea; `swarm task <tarea> --drop` olvida una tarea cuya reclamación se perdió.
- `swarm tick --plan p --db dir` - decide qué lanzar y qué integrar (`--db` es una copia de los documentos `state` y `sessions` del roadmap).
- `swarm integrate <tarea>` - fusiona una tarea aceptada en la rama de ejecución, comparando los validadores con la base.
- `swarm merge [--yes]` - fusiona la rama de ejecución en tu rama; sin `--yes` necesita el permiso dado al empezar.
- `swarm retry <tarea>` - devuelve al trabajo una tarea en conflicto o bloqueada.
- `swarm sleep <segundos> [--mark]` - espera entre ticks (hasta 900 s); `--mark` solo anota la hora de despertar.
- `swarm stop [--reason stopped|budget]`
- `stop` - para la ejecución infinita y la ejecución en paralelo.
- `hook live` - el hook de la señal en vivo (stdin: el evento del hook). No imprime nada.
- `--cwd <dir>` - en cualquier comando, lo ejecuta como si fuera desde ese directorio (validadores, git y ficheros del proyecto), para que una coordinadora nunca tenga que hacer `cd` a un worktree.

</details>
