<div align="center">

# 🔨 forge

**Una forma de trabajar adaptativa para Claude Code.**
Triaje por tamaño, el modelo adecuado para cada papel, primero tus propias herramientas, revisión independiente ponderada, y ejecuciones en paralelo o desatendidas cuando el trabajo es grande.

[English](README.md) · **Español** · [← bg-kit](../../README.es.md)

![versión 0.5.4](https://img.shields.io/badge/versi%C3%B3n-0.5.4-fab387?style=flat-square)
![depende de waypoint ^0.10.0](https://img.shields.io/badge/depende%20de-waypoint%20%5E0.10.0-cba6f7?style=flat-square)

</div>

<p align="center"><img src="../../docs/assets/paths.es.svg" alt="El triaje de forge lleva una tarea al camino Trivial, Small, Medium o Large; debajo, la escalera de implementadores y los tres revisores" width="100%"></p>

## Contenido

- [Por qué forge](#por-qué-forge)
- [Instalación](#instalación)
- [Uso](#uso)
- [Caminos](#caminos)
- [Agentes](#agentes)
- [El camino Large](#el-camino-large)
- [Enjambre](#enjambre)
- [Modo infinito](#modo-infinito)
- [Propuestas](#propuestas)
- [Configuración](#configuración)
- [Referencia de la CLI](#referencia-de-la-cli)

## Por qué forge

Hacer todas las tareas igual malgasta esfuerzo. Una revisión completa de un arreglo de una línea cuesta más de lo que ahorra, y un cambio grande sin revisión rompe cosas. forge mide cada tarea primero y gasta en proporción:

- **Proporcionado.** El trabajo trivial se queda en la sesión principal. Solo el trabajo Medium y Large paga revisión independiente.
- **Herramientas antes que opiniones.** Tus tests, linters, comprobador de tipos y build se ejecutan antes de que ningún revisor lea el diff.
- **Revisión independiente.** Los revisores son agentes aparte que no escribieron el código. Lo juzgan contra el brief y devuelven veredictos con nota, y forge los pondera en una decisión.
- **El modelo adecuado para cada papel.** El trabajo mecánico va a Haiku; el delicado, a Opus con esfuerzo muy alto.
- **Escala.** Los planes grandes se ejecutan como un enjambre de sesiones en paralelo, y el modo infinito sigue mejorando el proyecto dentro de un presupuesto.

## Instalación

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install forge@bg-kit
```

forge depende de [waypoint](../waypoint/README.es.md) ^0.10.0, que se instala con él. [lens](../lens/README.es.md) es opcional y recomendable. Reinicia Claude Code después de instalar o actualizar. Permiso recomendado: `Bash(node *forge.cjs*)`.

## Uso

| Comando | Qué hace |
| --- | --- |
| `/forge:run <tarea>` | Hace el triaje de la tarea y la trabaja por el camino que pide su tamaño. |
| `/forge:run --parallel N <tarea>` | Lo mismo, con un enjambre de hasta N sesiones en paralelo en el camino Large. |
| `/forge:infinite [--cycles N] [--hours H]` | Ciclos de mejora desatendidos dentro de un presupuesto. |
| `/forge:decide <id> approve\|reject\|comment <texto>` | Decide o comenta una propuesta desde cualquier sesión. |
| `/forge:stop` | Para la ejecución infinita o el enjambre. |

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
| `forge-planner` | Opus | muy alto | camino Large: convierte un diseño aprobado en un plan de waypoint |
| `forge-scout` | Opus | medio | modo infinito: propuestas de mejora con pruebas |

Los implementadores escriben su informe en `report-<n>.txt` y también lo incluyen en su respuesta. El perfil `economy` baja un nivel a los implementadores y `quality` los sube; los revisores nunca cambian.

## El camino Large

1. `/forge:run` ejecuta `/waypoint:design` y **espera a que apruebes el diseño**.
2. `forge-planner` escribe `plan.yaml` y `/waypoint:plan` publica el roadmap vivo.
3. `/waypoint:work` reclama cada tarea, y su paso «hacer el trabajo» se convierte en el bucle de forge: `brief --plan`, `triage --plan`, un implementador, los validadores y los tres revisores, durante hasta 4 rondas.
4. Al acabar las tareas, `review-correctness` revisa toda la rama contra el diseño y el plan, con como mucho un arreglo y una segunda revisión. La segunda revisión recibe validadores y diff nuevos, y un veredicto `redo` se trata como un arreglo.

La base de la ejecución se guarda en `.forge/work/<proyecto>/run.json`, que se escribe una vez tras aprobar el diseño. Mientras corre un implementador o un revisor, la sesión mantiene un `busyUntil` en su sesión de waypoint, para que las sesiones en paralelo no le quiten la tarea.

## Enjambre

<p align="center"><img src="../../docs/assets/swarm.es.svg" alt="Una coordinadora lanza sesiones en los frentes desbloqueados, cada una en su worktree, y las integra en main de una en una" width="100%"></p>

Con `swarm.parallel` a 2 o más en `.forge/config.yaml` (5 por defecto) o con `--parallel N`, el camino Large y el modo infinito se ejecutan como un **enjambre**, y la sesión solo coordina:

- **En cada tick** lista el roadmap, y `forge swarm tick` decide qué frentes lanzar con `waypoint launch --swarm` y qué trabajo integrar. Un frente solo se lanza cuando sus dependencias están integradas.
- **Cada frente** es una sesión en segundo plano en `.claude/worktrees/<frente>`, en la rama `track/<frente>`.
- **La integración** se hace con tu autorización (una sola vez), de un merge en uno, en la rama del checkout principal. Integra hasta la última tarea terminada del frente, pasa los validadores y hace commit, o deshace el merge si hay conflicto o falla un validador.
- **Entre ticks** duerme en segundo plano con `forge swarm sleep`.
- **El estado** vive en `.forge/swarm.json`, reflejado en el `meta/swarm` del roadmap. Lo enseñan el roadmap, lens y la banda.

Si el enjambre se para por un conflicto, `forge swarm retry <frente>` lo reactiva sin volver a lanzar `/forge:run`.

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

## Configuración

`.forge/` en el proyecto contiene `config.yaml`, el registro, `status.json`, `work/<id-de-tarea>/` (briefs, diffs, informes, revisiones), `proposals/`, `run.json`, `swarm.json` y `usage/`. Git ignora todo lo que hay dentro salvo `config.yaml`.

```yaml
profile: balanced          # balanced | economy | quality
validators:
  - name: unit
    cmd: npm test
    kind: test
    affects: ["src/**"]
validatorTimeoutSec: 600
swarm:
  parallel: 5              # 1 desactiva el enjambre; máximo 10
```

**Validadores.** Sin una lista `validators`, forge detecta las herramientas del proyecto. Una lista sustituye a la detección, y `validators: []` significa ninguno.

- `affects` es una lista de globs sobre rutas relativas al repo con separadores `/`. `*` casa dentro de un segmento de la ruta y `**` atraviesa segmentos (`src/**`, `web/*.ts`); no se admite otra sintaxis de glob.
- Un validador con `affects` solo se ejecuta en `validate --affected` si casa alguna de las rutas cambiadas. Sin `affects`, se ejecuta siempre.
- `--all` (o sin `--affected`) ejecuta todos los validadores. Los validadores `build` se saltan con `--affected`.

## Referencia de la CLI

Se ejecuta como `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs" <comando>`.

<details>
<summary><b>Tareas y revisión</b></summary>

- `triage [--task id] (<texto> | --text-file f)` - clasifica una tarea: camino, ficheros, zonas sensibles y validadores. `--text-file` lee el texto de un fichero, para que nunca pase por un shell.
- `triage --plan p --task T` - hace el triaje de una tarea del plan a partir de sus zonas y su `done_when`.
- `brief --plan p --task T [--design d]` - imprime el brief de una tarea del plan de waypoint, con la línea `Commit title prefix` que usan los implementadores.
- `validate [--affected a,b | --all] [--task id]` - ejecuta los validadores del proyecto.
- `verdict --task id --dir d [--validators f] [--sensitive] [--perf]` - pondera los JSON de los revisores en una nota. Un revisor aparece con `invalid: true` si su salida no servía (`dropped: 0`, cuenta como abstención) o si se descartaron algunos de sus hallazgos (`dropped` > 0; la revisión mantiene su veredicto y puntúa, y la skill registra los hallazgos descartados como resolución).
- `round --task id --path medium|large` - decide el siguiente paso del bucle de revisión (`done`, `resume`, `fresh-stronger`, `redo`, `breaker`, `stalled`; `tierUp` desde la ronda 3).
- `log --kind k [--task id] [--data json | --data-file f]` - añade una entrada al registro.
- `last --task id` - el camino, el último evento de fase, el último veredicto y la última ronda de una tarea.
- `agents` - los nombres de los agentes del perfil activo.
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
<summary><b>Modo infinito y enjambre</b></summary>

- `infinite start --cycles N | --hours H`, `infinite status`, `cycle --progress yes|no`, `stop`
- `swarm start | status | tick | integrate <frente> | mark <frente> | retry <frente> | sleep <segundos> [--mark] | stop`

</details>
