<div align="center">

# 🧭 waypoint

**Documentos de diseño, roadmaps vivos y seguimiento multisesión para tareas muy grandes de Claude Code.**

[English](README.md) · **Español** · [← bg-kit](../../README.es.md)

![versión 0.22.0](https://img.shields.io/badge/versi%C3%B3n-0.22.0-cba6f7?style=flat-square)
![requiere sesión en claude.ai](https://img.shields.io/badge/requiere-sesi%C3%B3n%20en%20claude.ai-89b4fa?style=flat-square)
![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A5%2020-a6e3a1?style=flat-square)

</div>

<p align="center"><img src="../../docs/assets/roadmap.es.svg" alt="El roadmap de waypoint: frentes con sus tareas, línea temporal y sesiones vivas" width="100%"></p>

## Contenido

- [Por qué waypoint](#por-qué-waypoint)
- [Características](#características)
- [Instalación](#instalación)
- [Uso](#uso)
- [El roadmap](#el-roadmap)
- [La banda](#la-banda)
- [Sesiones en paralelo](#sesiones-en-paralelo)
- [Sesiones: asiento y vínculo](#sesiones-asiento-y-vínculo)
- [Hooks](#hooks)
- [Referencia de la CLI](#referencia-de-la-cli)
- [Permisos](#permisos)
- [Desarrollo](#desarrollo)

## Por qué waypoint

Una tarea de decenas de pasos y varias sesiones pierde el hilo: qué se decidió, qué está hecho, quién trabaja en qué. waypoint guarda ese hilo fuera de la conversación. Mantiene un diseño que has aprobado, un plan en el repositorio y una página viva que todas las sesiones y todas las personas leen y escriben.

## Características

- **Diseño por rondas.** Un agente `design-critic` revisa el documento de diseño y devuelve propuestas numeradas con sus puntos críticos. Aplicas todas o algunas, pides otra ronda, haces que Claude te entreviste o lo reescribes, hasta que lo apruebas.
- **El plan en el repo.** `docs/waypoint/<proyecto>/plan.yaml` contiene frentes, fases y tareas, cada una con sus zonas (los ficheros que toca), `done_when` y una estimación. El diseño aprobado le da forma. Una tarea que forge debe tratar con cuidado lleva `delicate: true` (el roadmap lo ignora).
- **Un roadmap vivo.** El plan se publica como artifact de claude.ai y se actualiza mientras Claude trabaja. Sus vistas son Seguimiento (por fases o por frentes), Versiones, Sesiones, Notas y Propuestas, con filtros, línea temporal con zoom, dependencias, minimapa, exportación y diseño para móvil.
- **Sesiones en paralelo.** `/waypoint:launch <frente>` arranca una sesión en segundo plano en su propio worktree de git. Las sesiones aparecen en el roadmap y se coordinan con mensajes: avisos de solapamiento, traspasos y delegación.
- **Una banda sobre el prompt** que enseña dónde estás y ejecuta el siguiente comando con un clic.
- **No se pierde nada.** Los hooks registran cada commit y te recuerdan las escrituras pendientes en el roadmap antes de que la sesión pare.

## Instalación

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install waypoint@bg-kit
```

Necesita sesión iniciada en claude.ai (para los artifacts) y Node ≥ 20. Reinicia Claude Code después de instalar o actualizar.

## Uso

| Comando | Qué hace |
| --- | --- |
| `/waypoint:design [new [--from <spec>]\|round\|apply <all\|1,3>\|rewrite\|interview\|approve]` | Escribe un documento de diseño (o importa un spec de superpowers con `new --from`), lo mejora en rondas de crítica y lo aprueba. El diseño aprobado da forma al plan. |
| `/waypoint:plan` | Escribe o sincroniza `docs/waypoint/<proyecto>/plan.yaml` y publica el roadmap vivo. |
| `/waypoint:work [frente]` | Toma tareas una a una; el roadmap se actualiza en vivo. |
| `/waypoint:status` | Resumen del progreso. |
| `/waypoint:launch <frente>` | Arranca una sesión en segundo plano en un frente, en su propio worktree de git. |

Un recorrido típico:

```text
/waypoint:design new              # primer borrador
/waypoint:design round            # el crítico propone cambios numerados
/waypoint:design apply 1,3        # aplicas los que quieras
/waypoint:design approve
/waypoint:plan                    # plan.yaml + la URL del roadmap
/waypoint:work                    # o lanza una sesión por frente
```

`/waypoint:design new --from docs/superpowers/specs/<fichero>.md` parte de un spec escrito con superpowers: sus secciones se copian tal cual y la página del diseño dice «Importado de».

Una propuesta que no aplicas sigue pendiente entre rondas: la banda cuenta las pendientes de todas las rondas, el crítico de la ronda siguiente no las repite y `approve` lista las critical y major que siguen abiertas y te pide aplicarlas o descartarlas.

Cada snapshot anota lo que aplicó: `/waypoint:design apply r1:4,5 r2:all` aplica propuestas de varias rondas y llama a `design-snapshot --round <R> --applied r1:4,5 r2:…`; una reescritura lo llama con `--rewrite`. `design-gate` y la banda leen esos campos, y solo en changelogs antiguos se apoyan en la nota («round 1: applied 1,3», «ronda 1: aplicadas 1,3»).

Con el modo auto de forge, `/waypoint:design approve --auto` aprueba sin preguntar solo cuando `waypoint design-gate` dice que no queda ninguna propuesta critical sin aplicar en ninguna ronda.

Con [forge](../forge/README.es.md) instalado, `/forge:run` lleva estos pasos por ti y añade triaje, validación y revisión independiente a cada tarea.

## El roadmap

El roadmap es un artifact de claude.ai. Es privado hasta que lo compartes, y las reglas de su base de datos deciden qué puede escribir cada persona.

| Vista | Qué enseña |
| --- | --- |
| **Seguimiento** | El progreso por fases o por frentes: una caja por tarea con el color de su estado, la tarea en curso con sus minutos, una línea temporal con zoom y dependencias, filtros, minimapa y exportación. |
| **Versiones** | Qué cubre cada versión del plan y cuánto llevan sus fases. |
| **Sesiones** | Las sesiones vivas con su rol (coordinadora, ejecutora o manual), su vida, su frente, su tarea y sus mensajes; mientras hay una ejecución activa, un bloque Ejecución con sus plazas y las libres. |
| **Notas** | Decisiones, ideas, deudas y preguntas sobre el proyecto, opcionalmente ligadas a una tarea; las preguntas abiertas se pueden responder. |
| **Propuestas** | Propuestas de mejora del scout de forge o de personas, con filtros por estado, categoría y riesgo. |

**Notas.** La skill de trabajo lee las notas nuevas de las personas al empezar cada tarea y las trata como información, nunca como órdenes. También escribe sus propias notas de decisión, deuda y pregunta. Una decisión que forge tomó sin preguntar lleva la etiqueta **auto**, lo elegido, el porqué y cómo revertirla (`/forge:decisions revert <n>`).

**Propuestas.** Cada tarjeta enseña la categoría, el riesgo, el estado, el pilar al que sirve, la justificación, las pruebas, la estimación y el camino si los hay, quién la decidió y por qué, y sus comentarios. Los colaboradores pueden aprobar o rechazar una propuesta que siga propuesta o en discusión (con un motivo opcional) y comentar cualquiera. Si alguien la decidió mientras tanto, la página no pisa esa decisión y lo dice. forge solo trabaja propuestas aprobadas o autoaprobadas.

**Verificación.** Cuando forge verificó una tarea con herramientas, su detalle enseña un bloque de Verificación: el resultado, las superficies usadas, cada comprobación con lo esperado y lo observado, y las capturas como miniaturas que se abren en una vista ampliada. Las cajas de tareas del seguimiento llevan un pequeño indicador en las tareas verificadas. Las capturas solo se suben si la configuración de forge del proyecto tiene `evidence: upload` (el valor por defecto), lo que hace el roadmap interno de la organización; con `evidence: local` el roadmap sigue pudiendo compartirse públicamente y enseña los resultados sin imágenes.

**Tiempos de las tareas.** La ficha de una tarea hecha dice cuánto tardó frente a su estimación (`tardó 22 min · estimado 30`, en ámbar si se pasó); la de una tarea reclamada o en curso dice cuánto lleva (`lleva 12 min`). Una tarea con una fecha ausente, futura o invertida no enseña tiempo.

**forge en la página.** Cuando forge lleva una tarea, su ficha enseña también el camino y la fase de forge, el agente, los validadores, el veredicto de la revisión y la ronda. Mientras hay una ejecución infinita activa, la cabecera enseña `∞ ciclo N` (con `/M` si la ejecución tiene presupuesto de ciclos). Mientras hay una ejecución de forge activa, la cabecera enseña la píldora `▶ ejecución · subagentes 2/3` (modo, tareas en marcha sobre el máximo); añade `sin señal desde 12:40` cuando la coordinadora lleva 7 minutos en silencio y `parada desde 12:40` pasados 12, y marca las integraciones de la ejecución en la línea temporal.

**Ejecución.** La vista Sesiones abre con un bloque Ejecución: una línea por tarea en marcha con su etapa, agente y cuánto lleva (`lleva 12 min`), las plazas usadas sobre el máximo (`2/3 plazas`) y las libres. Las tarjetas de sesión llevan una etiqueta de rol (coordinadora, ejecutora, manual) y un punto de vida. Una tarea en curso cuya ejecutora dejó de renovar su concesión se marca **huérfana** y cuenta como bloqueada en los filtros, para que lo notes y otra sesión pueda recuperarla. La página lee todo esto del documento `meta/run` del roadmap (`runId`, `mode`, `parallel`, `branch`, `mergeOnFinish`, `active`, `stopReason`, `coordinator` y una plaza por tarea en marcha con su `task`, `stage`, `agent`, `by` y `since`), que forge mantiene al día.

**Tareas sueltas.** Cuando hay una ejecución efímera de forge (varias peticiones independientes en paralelo), la vista de seguimiento tiene una sección **Tareas sueltas** con el título, estado, etapa y agente de cada petición (y, una vez integrada o bloqueada, cuánto tardó, `tardó 6 min`, cuando la coordinadora lo publica), y la píldora de la ejecución se lee `▶ tareas sueltas · subagentes n/N`. No cuentan en el progreso del plan ni entran en `plan.yaml`.

**Depurar la página.** Añade `?debug=1` a la dirección del roadmap (o `#debug=1` a su hash): la página lista, por documento, lo que descartó o corrigió al leer los datos del roadmap.

**Permisos.** Los colaboradores solo pueden escribir notas y propuestas. Todo lo demás (plan, estado, sesiones, eventos, mensajes) necesita permiso de editor. Claude escribe con ArtifactData como propietario, y las reglas nunca lo limitan. Sin una persona con sesión iniciada, o si la base de datos rechaza una nota, el editor de notas queda en solo lectura.

> Después de actualizar el plugin, ejecuta `/waypoint:plan` y vuelve a publicar para que la página reciba las vistas nuevas. Un roadmap publicado por primera vez con 0.7.x o anterior debe republicarse una vez con las capacidades nuevas; la skill de plan las pasa.

## La banda

<p align="center"><img src="../../docs/assets/band.es.svg" alt="La banda sobre el prompt en los modos diseño, trabajo y ejecución" width="100%"></p>

| Modo | Enseña | Botones |
| --- | --- | --- |
| **Diseño** | Versión del diseño, propuestas y puntos críticos de la última crítica | Aplicar todas, Elegir…, Otra ronda, Reescribir, Preguntarme, Aprobar, Ver diseño |
| **Trabajo** | Tu frente y su progreso, la tarea en curso con sus minutos, el progreso global, mensajes sin leer, una decisión pendiente | Siguiente tarea, Estado, Lanzar sesión en un frente…, Abrir roadmap |
| **Ejecución** | La ejecución (`▶ EJECUCIÓN · subagentes 2/3 · T004 revisar (r2) · … · 3/12 · integradas 3`): modo, tareas en marcha sobre el máximo, cada tarea con su etapa y ronda, tareas integradas sobre el total del plan (o del lote); una ejecución atascada enseña solo `▶ EJECUCIÓN parada`, y se añade `⚠ sin señal` o `⚠ parada` cuando la coordinadora o una tarea en marcha se queda en silencio o se para | Estado, Parar, Abrir roadmap |

Si forge decidió algo sin preguntar en el último día, cualquier banda acaba con `⚑ auto · N · <la última decisión de peso>`.

Con [lens](../lens/README.es.md) instalado, un botón **Panel** abre el panel de progreso. Si un comando no puede ejecutarse desde la banda, queda en el prompt con el aviso «pulsa Enter».

La banda se dibuja en la terminal y en la pestaña Code de la app de escritorio. No se dibuja en el panel de VS Code ni con `-p`; ahí usa los comandos directamente.

## Sesiones en paralelo

`/waypoint:launch <frente>` crea `.claude/worktrees/<frente>` en la rama `track/<frente>` y arranca allí una sesión de Claude en segundo plano. Cada sesión reclama tareas de su frente y escribe su progreso en el roadmap. Cuando dos sesiones tocan los mismos ficheros, reciben un aviso de solapamiento. Las sesiones pueden traspasarse o delegarse trabajo con mensajes, que se guardan en el roadmap y se envían con `SendMessage`. Si una sesión desaparece, las demás recuperan su tarea. El prompt es `/waypoint:work <frente>` (más la autorización de fusión con `--merge`); un frente de un plan que está ejecutando forge se une solo a esa ejecución como miembro manual (`/waypoint:work` §0.5). Sus worktrees no salen en `git status`: se añaden a `.git/info/exclude` si nada los ignora.

El modo sessions de forge lanza a sus miembros con `launch <plan> <T> --task --run R --coordinator SID --base B [--effort e] [--model m] [--launcher bg|herdr]`: una sesión por tarea, en `.claude/worktrees/task-<T>` sobre `task/<T>`, que arranca con `/forge:member`. `--effort` (`low`, `medium`, `high`, `xhigh`, `max`) y `--model` (`opus`, `sonnet`, `haiku`) van al comando `claude --bg`, así que el miembro no hereda el esfuerzo de tu sesión; forge pasa los de su ajuste `swarm.member` (medium por defecto) y cualquier otro valor sale con código 2. La banda de un miembro así dice «de la ejecución de <coordinadora>». Cualquier sesión puede además unirse desde `/waypoint:work` a una ejecución en marcha como miembro manual y coger una tarea pendiente. Los ids de sesión que se usan con una ejecución de forge deben cumplir `[A-Za-z0-9_.-]` (sin `~ : @ +`): forge rechaza cualquier otro.

Para muchos frentes a la vez con integración automática, usa los [modos de ejecución](../forge/README.es.md#modos-de-ejecución) de forge.

## Sesiones: asiento y vínculo

El trabajo del roadmap de un checkout es de una conversación a la vez. `.waypoint/<proyecto>/session.json` es el **asiento** (su id, `main` o el frente, es el documento `sessions/<SID>` del roadmap) y `.waypoint/<proyecto>/bound.json` es el **vínculo** de ese asiento con la conversación de Claude que lo trabaja: `{sid, claude, pid, via, since, seenAt, endedAt, endReason}`. Lo crean `/waypoint:work`, `/waypoint:design`, `/forge:run`, `/forge:member` y `/forge:infinite` con `waypoint bind`; lo cierran el hook `SessionEnd` y `waypoint release`. Caduca 5 minutos después de su última renovación, o al instante si el proceso que registró ya no existe. En esta versión lo renuevan los hooks de su propia conversación, sea cual sea su papel (también una coordinadora o un miembro de forge), como mucho una vez por minuto y solo mientras esa conversación los ejecuta; desde la siguiente versión lo renueva además la banda. Un vínculo liberado sigue liberado, incluso tras un compact o un resume. Una conversación tiene un asiento por proyecto: ligar otro termina el primero.

Cada sesión calcula su papel con esos ficheros, y los hooks actúan según él:

| Papel | Quién | Qué recibe |
| --- | --- | --- |
| dueña | la conversación ligada al asiento | el contexto de arranque con su tarea, sus commits apuntados, el aviso del Stop |
| dueña por forge | la coordinadora de forge y los miembros de su ejecución | nada de estos hooks: les habla el hook de forge |
| otra viva | cualquier otra conversación mientras la dueña sigue viva | una línea al arrancar que dice quién trabaja el roadmap; nada más |
| previa | una conversación posterior cuando la dueña terminó (`/clear`, salir, un cierre inesperado) con una tarea a medias, durante 24 horas | una línea al arrancar que nombra la tarea que quedó a medias: `/waypoint:work resume` la retoma y `/waypoint:work release` la libera en el roadmap |
| ninguna | cualquier otra | una línea en un arranque nuevo si el proyecto tiene plan |

`/waypoint:work` nunca toma un asiento que tiene otra conversación viva (`waypoint bind` sale con 3): ofrece, por este orden, un frente en un worktree (`/waypoint:launch`), un segundo asiento en este checkout (`main-2`, en `.waypoint/<proyecto>/seats/main-2/`, con sus propios ficheros) o un relevo explícito; si otro asiento tiene una tarea que dejó a medias una conversación anterior, ofrece también retomarla allí. Dos asientos de un mismo checkout comparten su HEAD, así que cada uno apunta solo los commits de sus propios `git commit`, `merge`, `cherry-pick`, `revert`, `rebase --continue` o `am`, y un segundo asiento completa su tarea con `done --rev`. Quedan dos residuos: un `git rebase` simple ahí no apunta nada (sus commits reescritos se registran a mano), y un commit que llega mientras sigue en marcha el comando de commit del otro asiento puede quedar apuntado en los dos, nunca en ninguno. Si la conversación anterior terminó con una tarea a medias, `bind` sale con 4 y pregunta antes. Tras `/clear` la conversación nueva recibe la oferta de la anterior, no su herencia: no se retoma nada hasta que lo digas, y `/waypoint:work resume` toma el asiento donde quedó la tarea, también un segundo asiento (una conversación que ya trabaja una tarea en su propio asiento conserva ese). La dueña conserva el vínculo al terminar una tarea. Una conversación abierta antes de la 0.22 no tiene vínculo, ni contexto de arranque, hasta su siguiente `/waypoint:work`.

La skill de trabajo ya no compone las escrituras de una tarea en el roadmap: `waypoint claim`, `done`, `block --why-file f` (que además rellena `state/T.blockedReason`) y `heartbeat` las imprimen listas, con `now`, los ids de evento y el lease, y cada latido renueva `leaseUntil`. Una sesión de frente pide `next` con `--base` y para con `waiting_on` cuando su siguiente tarea espera trabajo de otro frente que aún no está en la base.

## Hooks

- **SessionStart** (sesión nueva, reanudada, limpiada, compactada o bifurcada) da a la dueña del asiento el contexto del roadmap o del borrador con su tarea; cualquier otra sesión recibe una línea que dice quién trabaja el roadmap, o la oferta de lo que una conversación anterior dejó a medias; la coordinadora y los miembros de una ejecución de forge lo oyen de forge. Una conversación reanudada o compactada reabre su vínculo, salvo que lo hubiera liberado.
- **SessionEnd** cierra los vínculos de esta conversación, con el motivo (`clear`, `resume`, `logout`, `prompt_input_exit`, `other`).
- **PostToolUse** (Bash), solo para la dueña, apunta en `<asiento>/pending-commits.jsonl` cada commit que HEAD ganó en el worktree del comando desde su base de `last-head.json` (primer padre, 20 como mucho: un merge de main añade solo su propio commit), y quita las líneas de los commits que se llevó un amend, un rebase o un reset. Lo que se commitea mientras el asiento no tiene tarea abierta nunca se da a la siguiente. Cuando otro asiento vivo trabaja el mismo worktree, solo apunta con un comando que crea commits, y nunca lo que el otro asiento ya había visto. La skill de trabajo registra los commits intermedios como eventos `commit` y quita sus líneas, y vacía el fichero al completar o dejar una tarea.
- **Stop**, solo para la dueña, te avisa una vez por cada conjunto distinto de pendientes mientras `pending-commits.jsonl` o `queue.jsonl` del asiento tengan líneas, para que no se pierda ningún commit ni escritura en el roadmap. Nunca para a una sesión que coordina o es miembro de una ejecución activa de forge, ni a la sesión del modo infinito de forge, y los commits de la tarea que tienes en curso solo cuentan cuando termina. Si vuelves a parar sin nada nuevo, deja pasar, y nunca bloquea cuando el hook Stop ya está activo.

## Referencia de la CLI

Las skills ejecutan la CLI como `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" <comando>`. `bin/waypoint` es un envoltorio para shells que tienen el `bin/` del plugin en el PATH.

| Grupo | Comandos |
| --- | --- |
| Diseño | `design-import <spec> --project P --out D`, `design-validate`, `design-snapshot <design.md> --note n [--round R] [--applied r<R>:<n,…>…] [--rewrite]`, `design-changed`, `design-gate <design.md>` (con las propuestas `pending` de todas las rondas), `critique-check`, `critique-select`, `critique-dismiss <design.md> --round R <all\|1,3>`, `design-page`, `design-park <design.md>` |
| Plan y página | `validate`, `hash` (imprime el hash del plan, para detectar un roadmap desactualizado), `page [--publish-info]` (las capacidades con las que publicar y la línea que avisa de que la página queda interna), `sync` (con la línea del informe: URL y cuentas), `clean-cache` |
| Trabajo | `next [--base <rama>]` (con `waiting_on`), `conflicts`, `recover [--minutes N]` (por debajo de 5 vale 5), `status`, `commit-info`, `claim`, `done`, `block --why-file f`, `heartbeat [--register] [--busy-until t] [--idle]` (cada uno imprime `{now, eid, eids, leaseUntil, batch}`) |
| Sesiones | `launch <frente> [--base <rama>]`, `launch <plan> <T> --task --run R --coordinator SID --base B [--effort e] [--model m] [--launcher bg\|herdr]`, `inbox`, `escalations`, `notes [--plan p] [--locale es\|en]` (con una línea que decir por cada nota de una persona), `session-id`, `bind <plan\|design> --via v [--seat s \| --second-seat] [--resume] [--takeover]`, `release <plan> [--seat s] [--free T --state-version V]` |
| Utilidades | `event-id`, `now` |

## Permisos

Opcionales; añádelos a `permissions.allow` en `~/.claude/settings.json` para que la skill de trabajo no pregunte en cada llamada:

```json
{ "permissions": { "allow": ["Bash(node *waypoint.cjs*)", "ArtifactData", "Bash(git *)"] } }
```

`ArtifactData` es el nombre con el que las skills de este plugin llaman a la herramienta. Si Claude Code la muestra con otro nombre (por ejemplo `mcp__…__ArtifactData`), usa ese.

## Desarrollo

Desde la raíz del repositorio: `npm install`, `npm test` y luego `npm run build`, que regenera `dist/`, `assets/`, `hooks/register.js` y `types/index.d.ts` (súbelos al repo).

La banda es un mod (`src/mod/register.tsx`, empaquetado en `hooks/register.js`):

- `claude plugin validate plugins/waypoint` comprueba el manifiesto, el módulo de hooks y su contrato de estado.
- `claude plugin test plugins/waypoint` ejecuta `plugins/waypoint/tests/*.test.ts` contra el motor.
- `npm run typecheck:mod` comprueba los tipos de los mods (la banda de waypoint y lens) y sus tests contra los tipos de la API del motor en `types/claude-code/index.d.ts` (ignorado en git); antes corre `mod-types check`, que dice cómo obtenerlos. `npm run mod-types:update` copia ahí la más nueva de las copias que Claude Code escribe al cargar la carpeta de un mod (`claude --plugin-dir plugins/waypoint` escribe `plugins/waypoint/.claude-plugin/types/claude-code/index.d.ts`) y, en un worktree enlazado, la `types/claude-code/` del checkout principal.

Sube la versión en `plugin.json` con cada cambio: la caché de plugins instalados va por versión.
