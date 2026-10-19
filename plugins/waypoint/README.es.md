<div align="center">

# 🧭 waypoint

**Documentos de diseño, roadmaps vivos y seguimiento multisesión para tareas muy grandes de Claude Code.**

[English](README.md) · **Español** · [← bg-kit](../../README.es.md)

![versión 0.31.0](https://img.shields.io/badge/versi%C3%B3n-0.31.0-cba6f7?style=flat-square)
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
- **Un roadmap vivo.** El plan se publica como artifact de claude.ai y se actualiza mientras Claude trabaja. Sus vistas son Resumen, Plan, Cronograma, Ejecuciones, Sesiones y Conversación, bajo una franja de estado, con «Te necesita», un detalle de tarea en cuatro pestañas, filtros, línea temporal con zoom, dependencias, minimapa, exportación y diseño para móvil.
- **Sesiones en paralelo.** `/waypoint:launch <frente>` arranca una sesión en segundo plano en su propio worktree de git. Las sesiones aparecen en el roadmap y se coordinan con mensajes: avisos de solapamiento, traspasos y delegación.
- **Una banda sobre el prompt** que enseña dónde estás y ejecuta el siguiente comando con un clic o una tecla.
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
| `/waypoint:design [new [--from <spec>]\|round [--verify]\|apply <all\|1,3>\|rewrite\|interview\|approve\|amend\|reopen\|resume\|park]` | Escribe un documento de diseño (o importa un spec de superpowers con `new --from`), lo mejora en rondas de crítica y lo aprueba. El diseño aprobado da forma al plan. |
| `/waypoint:plan` | Escribe o sincroniza `docs/waypoint/<proyecto>/plan.yaml` y publica el roadmap vivo. |
| `/waypoint:work [frente]` | Toma tareas una a una; el roadmap se actualiza en vivo. |
| `/waypoint:status` | Resumen del progreso. |
| `/waypoint:launch <frente>` | Arranca una sesión en segundo plano en un frente, en su propio worktree de git. |

Un recorrido típico:

```text
/waypoint:design new              # primer borrador
/waypoint:design round            # el crítico propone cambios numerados
/waypoint:design apply 1,3        # aplicas los que quieras
/waypoint:design round --verify   # el crítico revisa lo que aplicaste
/waypoint:design approve
/waypoint:plan                    # plan.yaml + la URL del roadmap
/waypoint:work                    # o lanza una sesión por frente
```

`/waypoint:design new --from docs/superpowers/specs/<fichero>.md` parte de un spec escrito con superpowers: sus secciones se copian tal cual y la página del diseño dice «Importado de».

Una propuesta que no aplicas sigue pendiente entre rondas: la banda cuenta las pendientes de todas las rondas, el crítico de la ronda siguiente no las repite y `approve` lista las critical y major que siguen abiertas y te pide aplicarlas o descartarlas.

Cada snapshot anota lo que aplicó: `/waypoint:design apply r1:4,5 r2:all` aplica propuestas de varias rondas y llama a `design-snapshot --round <R> --applied r1:4,5 r2:…`; una reescritura lo llama con `--rewrite`. `design-gate` y la banda leen esos campos, y solo en changelogs antiguos se apoyan en la nota («round 1: applied 1,3», «ronda 1: aplicadas 1,3»).

**Un crítico que converge.** Cada ronda tiene un presupuesto: la ronda 1 lo revisa todo con hasta 12 propuestas de cualquier gravedad; la 2, hasta 6, critical y major, sobre lo que cambió; desde la 3, y en `round --verify`, hasta 3 critical (un diseño reabierto empieza de nuevo: la primera ronda tras reabrir tiene el presupuesto de la ronda 1). El crítico escribe `verdict: ready` cuando no queda nada critical ni major (una crítica sin propuestas es válida), no vuelve a proponer lo que descartaste (`critique-dismiss --reason-file` guarda tu motivo; un motivo ya guardado no se sobrescribe nunca) ni lo que resolviste en una entrevista (`design-snapshot --resolved r1:4`), y no critica el texto de sus propias propuestas aplicadas. `critique-next` dice qué ronda toca, su presupuesto y qué revisa; `round --verify` lee solo las secciones cambiadas desde la última crítica, y todo cuando un cambio solo quitó secciones (al crítico se le dice cuáles). Una crítica que no pasa `critique-check` dos veces se aparta como `r<R>.rejected.json` (`--reject-on-fail`) y nunca cuenta como ronda. Una edición a mano del diseño tras su último snapshot también cuenta como un cambio que ningún crítico ha leído (`design-gate` la indica con `handEdit`): `/waypoint:design round` la guarda antes en un snapshot, y después `round --verify` la da por leída. Con el modo auto de forge, `/waypoint:design approve --auto` aprueba sin preguntar solo cuando `waypoint design-gate` dice que no queda ninguna propuesta critical ni major en ninguna ronda y que un crítico ha leído todo cambio aplicado (`needsVerify`).

**Diseños aprobados: enmendar o reabrir.** Un cambio pequeño en un diseño aprobado es una enmienda (`/waypoint:design amend`): sigue aprobado, y `waypoint design-impact` lista las tareas del plan cuyo `design_ref` apunta a una sección cambiada o quitada, para que `/waypoint:plan` sincronice el plan y su `design_version`. Uno mayor lo reabre (`/waypoint:design reopen`): vuelve a borrador y pasa por el crítico, con el presupuesto completo en su primera ronda. La skill `plan` escribe el enlace ella misma: `artifacts.design`, `design_version` y el `design_ref` de cada tarea.

**Las críticas en el repositorio.** Las críticas y `dismissed.json` viven en `docs/waypoint/<project>/design/critiques/` y se commitean con el diseño; las de versiones anteriores en `.waypoint/<project>/` se siguen leyendo. La página del diseño enseña cada ronda con su veredicto y qué pasó con cada propuesta (aplicada en vN, descartada con su motivo, resuelta en la entrevista, reescrita o pendiente), qué cambió cada versión (frente a una versión anterior cuando a la historia le falta la previa, y lo dice), cuántas propuestas quedan pendientes en total y una insignia de estado (borrador, aprobado, aprobado · enmendado, aparcado). Si los dos sitios tienen un `dismissed.json`, cuentan los dos.

Con [forge](../forge/README.es.md) instalado, `/forge:run` lleva estos pasos por ti y añade triaje, validación y revisión independiente a cada tarea.

## El roadmap

El roadmap es un artifact de claude.ai. Es privado hasta que lo compartes, y las reglas de su base de datos deciden qué puede escribir cada persona.

| Vista | Qué enseña |
| --- | --- |
| **Resumen** | Lo que te necesita, lo que está en curso (una fila por tarea: etapa, ronda, validadores, tiempo, agente y quién la ejecuta), las siguientes tareas libres, el progreso por versión y fase, la actividad reciente y las sesiones vivas. |
| **Plan** | Las fases una debajo de otra, la que está en curso abierta, cada una con su estado, objetivo, barra de progreso y tareas (por categorías si el plan las tiene); filtros por estado de la tarea, fase, aplazados, rondas sobre el tope y frente, que suman el plan y se quedan en la dirección (`pf=`). |
| **Cronograma** | Una línea temporal que se abre ajustada al plan con las fases en curso desplegadas, por fases, frentes, sesiones o categorías, con dependencias, filtros, minimapa y exportación, y el análisis: un solo fin previsto y cómo se calcula, un burndown frente al `target` de la versión, el camino crítico y las zonas de código por directorio. |
| **Ejecuciones** | La ejecución de forge activa con sus tareas, una atascada con el comando que la reanuda o la cierra, y el historial de las terminadas, guardado en `runs/`. |
| **Sesiones** | Las sesiones agrupadas por la ejecución para la que trabajan, con su rol, su vida, su frente, todas las tareas que llevan, las plazas de la coordinadora y sus mensajes. |
| **Conversación** | Notas y propuestas en una sola lista con un solo juego de filtros: una propuesta lleva sus comentarios, la tarea en la que se convirtió y su historial, y una pregunta que cerró una decisión dice cuál. |

**Franja de estado.** Arriba en todas las vistas: si la página está en vivo (o, antes de que conteste la base, la fecha de los estados con los que se publicó), una píldora para la ejecución de forge y otra para el modo infinito (amarilla si su coordinadora está en silencio, roja si se paró), el % de la versión actual, el fin previsto, cuándo se sincronizaron los estados y un enlace al diseño. En el móvil, las vistas son una barra de pestañas abajo.

**Te necesita.** El Resumen abre con lo que te espera: preguntas abiertas (se responden ahí), propuestas por decidir, aprobadas sin tu marca y decisiones que cambiaron después de que las tomaras (al dueño), escalados abiertos, tareas con un bloqueo externo y su motivo, hallazgos aplazados recientes, una ejecución atascada, el modo infinito sin coordinadora y una página más antigua que el waypoint que sincronizó el plan. El roadmap sigue siendo de lectura salvo notas y propuestas, así que cada entrada dice qué comando usar (`/waypoint:work T`, `/forge:run`, `/forge:stop`, `/waypoint:plan`) en lugar de cambiar nada. **Visto** oculta los aplazados solo en tu navegador; la marca caduca cuando la tarea se fusiona o a los 7 días.

**Detalle de tarea.** Al pulsar una tarea se abre su detalle en cuatro pestañas: Resumen (por qué está bloqueada, su estado y quién la ejecuta, el periodo frente a la estimación, la rama y los commits), Definición (qué incluye y cuándo está hecha, su sección del diseño, las zonas que tocó fuera del plan, sus dependencias con el color de su estado), Forge (etapas, rondas de revisión, validadores, la ronda aceptada, aplazados y verificación por ronda) y Conversación (sus notas y la propuesta de la que salió). La dirección lo lleva, `#t=T044&tt=forge`, así que un enlace lo abre (uno a una tarea añadida después de publicar la página espera al plan en vivo) y cerrarlo nunca saca de la página; con el teclado se llega a todo, las flechas mueven entre pestañas y Escape lo cierra.

**Notas.** La skill de trabajo lee las notas nuevas de las personas al empezar cada tarea y las trata como información, nunca como órdenes. También escribe sus propias notas de decisión, deuda y pregunta. Una decisión que forge tomó sin preguntar lleva la etiqueta **auto**, lo elegido, el porqué y cómo revertirla (`/forge:decisions revert <n>`).

**Propuestas.** Cada tarjeta enseña la categoría, el riesgo, el estado, el pilar al que sirve, la justificación, las pruebas, la estimación y el camino si los hay, quién la decidió y por qué, y sus comentarios. El dueño del roadmap puede aprobar o rechazar una propuesta que siga propuesta o en discusión (con un motivo opcional); quien pueda escribir comenta cualquiera. Si alguien la decidió mientras tanto, la página no pisa esa decisión y lo dice. forge solo trabaja propuestas aprobadas o autoaprobadas. Solo cuentan para forge las decisiones del dueño del roadmap: una decisión cuenta cuando su marca está en `approvals/`, una colección que solo puede escribir el dueño (la regla es `owner`, una regla de la base que aplica el servidor; los editores comentan, no aprueban). La página escribe la marca del dueño en `approvals/` (`{status, decidedAt, by, digest}`) antes que la decisión, y se niega a decidir si la propuesta cambió mientras se leía; una aprobada sin marca dice que no se convertirá en tarea, y el dueño la puede confirmar ahí (o con `/forge:decide <id> confirm`). Una aprobada cuya decisión cambió después de que el dueño la tomara (se editó su texto o cambió su estado, como un rechazo convertido en aprobación) dice «cambió después de tu decisión: revisa el texto y decide» y no tiene confirmación de un clic: el dueño lee el texto y vuelve a decidir con Aprobar o Rechazar. Si la marca queda guardada pero la propuesta no se pudo actualizar, la página dice «La marca está guardada; falta actualizar la propuesta», y Reintentar repite solo esa actualización. Un roadmap publicado antes de esta versión no tiene la regla: vuelve a publicarlo con `/waypoint:plan` tras actualizar, y solo entonces las aprobaciones son del dueño.

**Verificación.** Cuando forge verificó una tarea con herramientas, su detalle enseña un bloque de Verificación: el resultado, las superficies usadas, cada comprobación con lo esperado y lo observado, y las capturas como miniaturas que se abren en una vista ampliada. Las cajas de tareas llevan un pequeño indicador en las tareas verificadas. Las capturas solo llegan al roadmap si tiene el almacén de capturas de forge, que lo hace interno de la organización: forge publica el roadmap con él en su camino Large si la configuración de forge del proyecto tiene `evidence: upload` (el valor por defecto), y `/waypoint:plan assets` se lo añade a un roadmap que publicaste tú (te lo pregunta una vez). Un roadmap publicado con el almacén lo conserva, y `evidence: local` de forge solo deja de subir capturas nuevas; `/waypoint:plan no-assets` lo vuelve compartible (te lo pregunta una vez). Sin el almacén el roadmap enseña los resultados sin imágenes.

**Tiempos de las tareas.** La ficha de una tarea hecha dice cuánto tardó frente a su estimación (`tardó 22 min · estimado 30`, en ámbar si se pasó); la de una tarea reclamada o en curso dice cuánto lleva (`lleva 12 min`). Una tarea con una fecha ausente, futura o invertida no enseña tiempo.

**forge en la página.** Cuando forge lleva una tarea, su fila en «En curso» y la pestaña Forge de su detalle enseñan su camino, su etapa, la ronda de revisión frente al tope, los validadores, el agente y quién la ejecuta. Mientras hay una ejecución infinita activa, la franja de estado enseña `∞ ciclo N` (con `/M` si la ejecución tiene presupuesto de ciclos). Mientras hay una ejecución de forge activa, la franja de estado enseña la píldora `▶ ejecución · subagentes 2/3` (modo, tareas en marcha sobre el máximo); añade `sin señal desde 12:40` cuando la coordinadora lleva 7 minutos en silencio y `parada desde 12:40` pasados 12, y marca las integraciones de la ejecución en la línea temporal.

**Ejecución.** La vista Ejecuciones enseña la ejecución activa: una fila de «En curso» por tarea en marcha con su etapa, agente y su tiempo en la etapa y en total, como duraciones (`12 min · 2 h 05 min`), y las plazas usadas sobre el máximo (`2/3 plazas`); la tarjeta de la coordinadora en Sesiones lista sus plazas, cada una con cuánto lleva (`lleva 12 min`), y las libres, y una ejecución terminada se queda en el historial. Las tarjetas de sesión llevan una etiqueta de rol (coordinadora, ejecutora, manual) y un punto de vida. Una tarea en curso cuya ejecutora dejó de renovar su concesión se marca **Sin ejecutor** y cuenta como bloqueada en los filtros, para que lo notes y otra sesión pueda recuperarla. La página lee todo esto del documento `meta/run` del roadmap (`runId`, `mode`, `parallel`, `branch`, `mergeOnFinish`, `active`, `stopReason`, `coordinator` y una plaza por tarea en marcha con su `task`, `stage`, `agent`, `by` y `since`), que forge mantiene al día.

**Datos del roadmap.** Las métricas viven en `meta/metrics` (el último commit y el número de tests, escritos aparte del batch de una tarea; la CLI lo imprime sin `if_version`, que se envía así solo para crear el documento: cuando ya existe, las skills lo fijan a su versión listada); la página también las lee de `meta/project.metrics` en un roadmap que escribió un forge anterior. `meta/page` dice qué waypoint publicó la página y con qué reglas. `waypoint sync --db` lee los listados del roadmap: nunca escribe sobre un documento cuya versión no conoce, conserva lo que era una tarea cuando el plan la quita y escribe `meta/project` al final. Sale con 2, sin imprimir nada, ante un listado que puede estar cortado en 1000 documentos y ante una fase o un `meta/project` que la base tiene y `known.json` no lista (vuelve a listar la base); e imprime `republish` cuando la página publicada es más antigua que el plugin o sus `rules` son anteriores a la regla de aprobaciones del dueño. El snapshot de la página lleva los estados listados (`page --states`), y forge escribe él mismo el bloque forge, la evidencia, las ejecuciones y el modo infinito de cada tarea.

**Tareas sueltas.** Cuando hay una ejecución efímera de forge (varias peticiones independientes en paralelo), la vista Ejecuciones tiene una sección **Tareas sueltas**, y las que están en marcha salen en «En curso», con el título, estado, etapa y agente de cada petición (y, una vez integrada o bloqueada, cuánto tardó, `tardó 6 min`, cuando la coordinadora lo publica), y la píldora de la ejecución se lee `▶ tareas sueltas · subagentes n/N`. No cuentan en el progreso del plan ni entran en `plan.yaml`.

**Depurar la página.** Añade `?debug=1` a la dirección del roadmap (o `#debug=1` a su hash): la página lista, por documento, lo que descartó o corrigió al leer los datos del roadmap.

**Permisos.** Los colaboradores solo pueden escribir notas y propuestas, y solo el dueño puede escribir `approvals/` (la regla es `owner`). Todo lo demás (plan, estado, sesiones, eventos, mensajes) necesita permiso de editor. Claude escribe con ArtifactData como propietario, y las reglas nunca lo limitan. Sin una persona con sesión iniciada, o si la base de datos rechaza una nota, el editor de notas queda en solo lectura.

> Después de actualizar el plugin, ejecuta `/waypoint:plan`: republica solo cuando la página publicada es más antigua que el plugin o le falta la regla `approvals/` del dueño (`meta/page`, que escribe cada publicación con las reglas que de verdad llevan sus capacidades). Cada publicación pasa las capacidades, así que un roadmap publicado por primera vez con un waypoint anterior recibe todas las reglas en su siguiente republicación. Una republicación que cambiaría quién puede ver y compartir el roadmap (`/waypoint:plan assets` añade el almacén de capturas de forge, que lo deja interno de tu organización; `/waypoint:plan no-assets` lo quita, que lo vuelve compartible) te pregunta antes, aunque la pida la actualización del plugin; si nadie puede responder, como en un ciclo de `/forge:infinite`, no se republica. Lo mismo pasa al republicar un roadmap cuyo `meta/page` no registra si tiene el almacén (uno sin republicar desde 0.26.0): seguir quita el almacén, y `/waypoint:plan assets` lo conserva.

## La banda

<p align="center"><img src="../../docs/assets/band.es.svg" alt="La banda sobre el prompt en los modos diseño, trabajo y ejecución" width="100%"></p>

| Modo | Enseña | Botones |
| --- | --- | --- |
| **Diseño** | Versión del diseño, propuestas y puntos críticos de la última crítica | Aplicar todas (`a`), Elegir… (`e`), Otra ronda (`o`), Reescribir (`w`), Preguntarme (`i`), Aprobar (`y`), Ver diseño (`d` fuera de fullscreen) |
| **Trabajo** | Tu frente y su progreso, la tarea en curso con su tiempo (`12 m / 30 m`; `9 h 58 m / 30 m` en ámbar cuando pasa de su estimación), el progreso global, mensajes sin leer (`✎ 1`), una decisión pendiente (`▲ decisión pendiente`) | Siguiente tarea (`n`), Estado (`s`), Lanzar sesión en un frente… (`l`), Abrir roadmap (`r` fuera de fullscreen); el Parar de un miembro de una ejecución (`t`) |
| **Ejecución** | La ejecución (`► EJECUCIÓN · subagentes 2/3 · T004 revisar (r2) · … · 3/12 integradas`): modo, tareas en marcha sobre el máximo, cada tarea con su etapa y ronda (hasta 12; las que no caben, y las que pasan de 12, se cuentan como `+N`), las integradas sobre el total del plan (o del lote) y `por integrar N` para las aceptadas; una ejecución atascada enseña `► EJECUCIÓN · ▲ parada`, y se añade `▲ sin señal` o `▲ parada` cuando la coordinadora o una tarea en marcha se queda en silencio o se para; `✎ N` y `▲ decisión pendiente`, como en trabajo | Estado (`s`), Parar (`t`, dos veces), Abrir roadmap (`r` fuera de fullscreen) |
| **Aviso** (atenuado, `notice`) | Lo que ve una conversación que no es la dueña del asiento: otra sesión viva trabaja el roadmap (`◦ otra sesión (main) trabaja en T019 · hace 3 min`) o su diseño (`◦ otra sesión (main) trabaja en el diseño · hace 3 min`), o coordina una ejecución de forge (`◦ ejecución de forge en curso, la coordina otra sesión · 3/12`); una conversación anterior dejó a medias una tarea, un borrador o una ejecución (`◌ quedó a medias: T019 API de pedidos · hace 2 h`, `◌ ejecución parada: 3/12 integradas · hace 2 h`), ofrecido durante 24 horas | Estado (`s`), Otro frente (`l`, no en el diseño), Abrir roadmap (`r` fuera de fullscreen) · Ver (`v`), Unirme (`j`, `/forge:run --join`, solo en una ejecución de plan) · Retomar (`e`, `/waypoint:work resume`), Liberar T019 (`f`, `/waypoint:work release T019`) · Retomar (`e`, `/waypoint:design resume`) · Ver (`v`), Retomar (`e`, `/forge:run --resume`), Cerrar (`c`, `/forge:stop`) |

**Ancho y teclado.** La banda se ajusta al ancho que tiene: cada parte lleva una prioridad y, cuando falta sitio, las menos importantes pasan primero a su forma corta (`frente core 2/5` se queda en `2/5`, el título de la tarea se recorta) y después se van; una decisión pendiente, una ejecución sin señal y el buzón son lo último que se pierde. Desde 140 columnas es una fila con los botones enteros; desde 90, dos filas con etiquetas cortas; más estrecha, con menos de 3 filas sobre el prompt o fuera de fullscreen, una fila cuyos botones se recogen en **⋯** (`m`). Una segunda fila que no cabe ocupa una segunda línea donde la banda tiene 3 filas o más, y solo entonces recorta sus etiquetas más largas, nunca tanto que dos botones se lean igual; lo que aún no cabe pasa a otra página de **⋯**, que `m` abre una tras otra. Cada botón tiene una letra: `n` Siguiente tarea, `s` Estado, `l` Lanzar…, `t` Parar, `p` Panel, y `x` cierra la banda; en diseño `a`, `e`, `o`, `w`, `i` y `y`; en un aviso `v`, `j`, `e`, `f` y `c`. El clic necesita fullscreen; en cualquier modo, `ctrl+x tab` da el teclado a la banda y las letras pulsan sus botones. Fuera de fullscreen los botones se leen `n: Siguiente` y la línea de pistas bajo el prompt acaba en `ctrl+x tab · banda`; ahí **Roadmap** (`r`) y **Ver diseño** (`d`) son botones que copian su dirección y la enseñan en un aviso, porque ninguna tecla abre un enlace. En fullscreen son enlaces que se pulsan con un clic, sin letra. El **Parar** (`t`) de la coordinadora pregunta dos veces: la primera pulsación enseña «Pulsa t otra vez para parar la ejecución» y la segunda, en 5 segundos, corre `/forge:stop`; lo mismo **Cerrar** (`c`) sobre una ejecución que sigue activa. El **Parar** de un miembro de la ejecución solo deja `/forge:stop` en el prompt, como se dice más abajo. La banda dice a lens si está pintada (`{ plugin: 'waypoint', key: 'drawn' }`), así que lens pinta la suya cuando cierras esta.

La banda se pinta según el papel: cada refresco compara `$.session.id()` con los vínculos del proyecto y con la ejecución de forge (ver [Sesiones: asiento y vínculo](#sesiones-asiento-y-vínculo)), y todo modelo de banda lleva ese papel como `viewer: { role, coordinator, runId }` (`runId` solo se rellena cuando la banda trata de la ejecución). La conversación ligada al asiento ve su banda de trabajo, o la de diseño mientras el borrador es suyo; la coordinadora de forge ve la banda de ejecución, la única con **Parar**; un miembro de la ejecución ve su propia tarea con la línea de la ejecución, y su **Parar** deja `/forge:stop` en el prompt para que confirmes. **Retomar** sobre un borrador lo liga y enseña su estado sin lanzar una ronda de crítica; **Cerrar** (`c`) sobre una ejecución que sigue activa sin su coordinadora pregunta dos veces, como **Parar**. Una ejecución activa queda sin coordinadora cuando la conversación de la coordinadora terminó, o cuando esta se quedó en silencio: ni un paso ni una señal en 12 minutos y ningún agente en marcha. **Unirme** solo sale en una ejecución de plan: la ejecución efímera de forge (briefs en paralelo) no admite miembros. En un checkout sin proyecto de waypoint la banda no pinta nada, pero su modelo sigue llevando el papel según la ejecución de forge, así que la coordinadora de forge se lee como `{ role: 'owner', coordinator: true, runId }`. **×** sobre un aviso se guarda en el almacén del plugin (`$.store`), compartido por tus conversaciones, por checkout, proyecto, tipo de aviso y sujeto hasta que el aviso acabaría (un día para el trabajo de otra sesión y para una oferta que ya pasó de sus 24 horas), así que una tarea o una ejecución nuevas vuelven a salir; **×** sobre tu propia banda dura la sesión. Tras `/clear` la banda sigue refrescándose y enseña al momento el papel de la conversación nueva. La banda quita los caracteres de control y bidireccionales de los títulos que enseña. Una conversación abierta antes de la 0.23 no ve la banda hasta su siguiente `/waypoint:work`.

Si forge decidió algo sin preguntar en el último día, cualquier banda acaba con `⚑ auto · N · <la última decisión de peso>`.

Con [lens](../lens/README.es.md) instalado, un botón **Panel** abre el panel de progreso. Si un comando no puede ejecutarse desde la banda, queda en el prompt con el aviso «pulsa Enter».

La banda se dibuja en la terminal y en la pestaña Code de la app de escritorio. No se dibuja en el panel de VS Code ni con `-p`; ahí usa los comandos directamente.

## Sesiones en paralelo

`/waypoint:launch <frente>` crea `.claude/worktrees/<frente>` en la rama `track/<frente>` y arranca allí una sesión de Claude en segundo plano. Ejecuta `waypoint launch <plan> <frente> --exec`, que arranca él mismo `claude --bg`, así que la skill no necesita el permiso de `claude --bg`; la salida de la sesión va a `.waypoint/<proyecto>/launch/<nombre>.log`. Cada sesión reclama tareas de su frente y escribe su progreso en el roadmap. Cuando dos sesiones tocan los mismos ficheros, reciben un aviso de solapamiento. Las sesiones pueden traspasarse o delegarse trabajo con mensajes, que se guardan en el roadmap y se envían con `SendMessage`. Si una sesión desaparece, las demás recuperan su tarea. El prompt es `/waypoint:work <frente>` (más la autorización de fusión con `--merge`); un frente de un plan que está ejecutando forge se une solo a esa ejecución como miembro manual (`/waypoint:work` §0.5). Sus worktrees no salen en `git status`: se añaden a `.git/info/exclude` si nada los ignora.

El modo sessions de forge arranca él mismo una sesión por tarea: `forge swarm tick` compone su arranque (el worktree `.claude/worktrees/task-<T>` sobre `task/<T>`, `/forge:member`, y el `--effort` y el `--model` de su ajuste `swarm.member`, medium por defecto) y la coordinadora lo ejecuta; `waypoint launch --task` sale con código 2. La banda de un miembro así dice «de la ejecución de <coordinadora>». Cualquier sesión puede además unirse desde `/waypoint:work` a una ejecución en marcha como miembro manual y coger una tarea pendiente. `session-id` solo da letras, dígitos, `_`, `.` y `-`, los ids que acepta forge.

Para muchos frentes a la vez con integración automática, usa los [modos de ejecución](../forge/README.es.md#modos-de-ejecución) de forge.

## Sesiones: asiento y vínculo

El trabajo del roadmap de un checkout es de una conversación a la vez. `.waypoint/<proyecto>/session.json` es el **asiento** (su id, `main` o el frente, es el documento `sessions/<SID>` del roadmap) y `.waypoint/<proyecto>/bound.json` es el **vínculo** de ese asiento con la conversación de Claude que lo trabaja: `{sid, claude, pid, via, since, seenAt, endedAt, endReason}`. Lo crean `/waypoint:work`, `/waypoint:design`, `/forge:run`, `/forge:member` y `/forge:infinite` con `waypoint bind`; lo cierran el hook `SessionEnd` y `waypoint release`. Caduca 5 minutos después de su última renovación, o al instante si el proceso que registró ya no existe. En esta versión lo renuevan los hooks de su propia conversación, sea cual sea su papel (también una coordinadora o un miembro de forge), como mucho una vez por minuto y solo mientras esa conversación los ejecuta: su `SessionStart`, su `Stop` y sus comandos que nombran git (el hook `PostToolUse` solo arranca para esos), así que un turno largo de otros comandos sin la banda lo deja caducar hasta que acaba el turno o corre un comando git; lo renueva además la banda cada minuto mientras la conversación sigue abierta (nunca uno que ya terminó). Un lector que encuentra `bound.json` vacío o a medio escribir lo lee una vez más. Un vínculo liberado sigue liberado, incluso tras un compact o un resume. Una conversación tiene un asiento por proyecto: ligar otro termina el primero.

Cada sesión calcula su papel con esos ficheros, y los hooks actúan según él:

| Papel | Quién | Qué recibe |
| --- | --- | --- |
| dueña | la conversación ligada al asiento | el contexto de arranque con su tarea, sus commits apuntados, el aviso del Stop |
| dueña por forge | la coordinadora de forge y los miembros de su ejecución | nada de estos hooks: les habla el hook de forge |
| otra viva | cualquier otra conversación mientras la dueña sigue viva | una línea al arrancar que dice quién trabaja el roadmap, y un aviso atenuado en la banda; nada más |
| previa | una conversación posterior cuando la dueña terminó (`/clear`, salir, un cierre inesperado) con una tarea a medias, durante 24 horas | una línea al arrancar que nombra la tarea que quedó a medias: `/waypoint:work resume` la retoma y `/waypoint:work release` la libera en el roadmap; la banda ofrece lo mismo con **Retomar** y **Liberar** |
| ninguna | cualquier otra | una línea en un arranque nuevo si el proyecto tiene plan |

`/waypoint:work` nunca toma un asiento que tiene otra conversación viva (`waypoint bind` sale con 3): ofrece, por este orden, un frente en un worktree (`/waypoint:launch`), un segundo asiento en este checkout (`main-2`, en `.waypoint/<proyecto>/seats/main-2/`, con sus propios ficheros) o un relevo explícito; si otro asiento tiene una tarea que dejó a medias una conversación anterior, ofrece también retomarla allí. Dos asientos de un mismo checkout comparten su HEAD, así que cada uno apunta solo los commits de sus propios `git commit`, `merge`, `cherry-pick`, `revert`, `rebase --continue` o `am`, y un segundo asiento completa su tarea con `done --rev`. Quedan dos residuos: un `git rebase` simple ahí no apunta nada (sus commits reescritos se registran a mano), y un commit que llega mientras sigue en marcha el comando de commit del otro asiento puede quedar apuntado en los dos, nunca en ninguno. Si la conversación anterior terminó con una tarea a medias, `bind` sale con 4 y pregunta antes. Tras `/clear` la conversación nueva recibe la oferta de la anterior, no su herencia: no se retoma nada hasta que lo digas, y `/waypoint:work resume` toma el asiento donde quedó la tarea, también un segundo asiento (una conversación que ya trabaja una tarea en su propio asiento conserva ese). La dueña conserva el vínculo al terminar una tarea. Una conversación abierta antes de la 0.22 no tiene vínculo, ni contexto de arranque, hasta su siguiente `/waypoint:work`.

La skill de trabajo ya no compone las escrituras de una tarea en el roadmap: `waypoint claim`, `done`, `block --why-file f` (que además rellena `state/T.blockedReason`) y `heartbeat` las imprimen listas, con `now`, los ids de evento y el lease, y cada latido renueva `leaseUntil`. Una sesión de frente pide `next` con `--base` y para con `waiting_on` cuando su siguiente tarea espera trabajo de otro frente que aún no está en la base.

## Hooks

- **SessionStart** (sesión nueva, reanudada, limpiada, compactada o bifurcada) da a la dueña del asiento el contexto del roadmap o del borrador con su tarea; cualquier otra sesión recibe una línea que dice quién trabaja el roadmap, o la oferta de lo que una conversación anterior dejó a medias; la coordinadora y los miembros de una ejecución de forge lo oyen de forge. Una conversación reanudada o compactada reabre su vínculo, salvo que lo hubiera liberado.
- **SessionEnd** cierra los vínculos de esta conversación, con el motivo (`clear`, `resume`, `logout`, `prompt_input_exit`, `other`).
- **PostToolUse** (Bash y PowerShell, solo para un comando que nombra git), solo para la dueña, apunta en `<asiento>/pending-commits.jsonl` cada commit que HEAD ganó en el worktree del comando desde su base de `last-head.json` (primer padre, 20 como mucho: un merge de main añade solo su propio commit), y quita las líneas de los commits que se llevó un amend, un rebase o un reset. Lo que se commitea mientras el asiento no tiene tarea abierta nunca se da a la siguiente. Cuando otro asiento vivo trabaja el mismo worktree, solo apunta con un comando que crea commits, y nunca lo que el otro asiento ya había visto. La skill de trabajo registra los commits intermedios como eventos `commit` y quita sus líneas, y vacía el fichero al completar o dejar una tarea.
- **Stop**, solo para la dueña, te avisa una vez por cada conjunto distinto de pendientes mientras `pending-commits.jsonl` o `queue.jsonl` del asiento tengan líneas, para que no se pierda ningún commit ni escritura en el roadmap. Nunca para a una sesión que coordina o es miembro de una ejecución activa de forge, ni a la sesión del modo infinito de forge, y los commits de la tarea que tienes en curso solo cuentan cuando termina. Si vuelves a parar sin nada nuevo, deja pasar, y nunca bloquea cuando el hook Stop ya está activo.

## Referencia de la CLI

Las skills ejecutan la CLI como `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" <comando>`. `bin/waypoint` es un envoltorio para shells que tienen el `bin/` del plugin en el PATH.

| Grupo | Comandos |
| --- | --- |
| Diseño | `design-import <spec> --project P --out D`, `design-validate`, `design-snapshot <design.md> --note n\|--note-file f [--round R] [--applied r<R>:<n,…>…] [--resolved r<R>:<n,…>…] [--rewrite] [--kind k]`, `design-changed` (con `removed`), `design-gate <design.md>` (las propuestas `pending`, `dismissed`, `resolved` y `applied` de todas las rondas, `majorPending` y `needsVerify`), `critique-next <design.md> [--verify] [--full]`, `design-impact <design.md> --plan P [--since N] [--states DIR]`, `critique-check [--verify] [--changed a,b] [--reject-on-fail]`, `critique-select`, `critique-dismiss <design.md> --round R <all\|1,3> [--reason-file F]`, `design-page <design.md> --out F`, `design-park <design.md>` |
| Plan y página | `validate [--design D]` (avisa de las tareas sin zonas: forge las ejecuta solas; con `--design`, avisa de un `design_ref` que no es una sección del diseño y de un `design_version` o un `artifacts.design` que no son los del diseño aprobado), `hash` (imprime el hash del plan, para detectar un roadmap desactualizado), `page [--publish-info --capabilities F [--page P] [--assets] [--no-assets]] [--states DIR]` (las capacidades con las que publicar, `assets` solo con `--assets` o si la página publicada ya lo tiene, nunca con `--no-assets` (los dos juntos salen con 2), la línea que avisa de que la página queda interna y la escritura de `meta/page`, cuyas `rules` y `assets` son las del fichero de capacidades `F` que se publicó; con `--page`, el `meta/page.json` listado, `capabilitiesChanged` y la línea `ask` cuando una republicación cambia quién puede ver el roadmap, o puede cambiarlo, porque esa página no registra `assets`), `sync [--db DIR]` (con la línea del informe: URL y cuentas; antes borra sus lotes viejos de `--out`; con `--db`, `removed`, `missing`, `unknownVersion` y `republish`), `clean-cache`, `doctor <plan> [--fix]` (lista lo que dejaron versiones anteriores en `.waypoint/<proyecto>/`; `--fix` lo borra) |
| Trabajo | `next [--base <rama>] [--messages <dir>]` (con `waiting_on`, y `multi`: otra sesión viva, un mensaje para esta, una tarea que dejó una sesión inactiva, o un worktree de frente), `conflicts`, `recover [--minutes N]` (por debajo de 5 vale 5), `status`, `commit-info`, `claim`, `done`, `block --why-file f`, `heartbeat [--register] [--busy-until t] [--idle]` (cada uno imprime `{now, eid, eids, leaseUntil, batch}`) |
| Sesiones | `launch <frente> [--base <rama>] [--exec]`, `inbox`, `escalations`, `notes [--plan p] [--locale es\|en]` (con una línea que decir por cada nota de una persona), `session-id`, `bind <plan\|design> --via v [--seat s \| --second-seat] [--resume] [--takeover]`, `release <plan> [--seat s] [--free T --state-version V [--keep-seat]]` (`--keep-seat` devuelve la tarea y deja el asiento ligado) |
| Utilidades | `event-id`, `now`, `hook <session-start\|session-end\|post-commit\|stop>` (lo que ejecuta `hooks.json`; lee el evento por stdin) |

## Permisos

Opcionales; añádelos a `permissions` en `~/.claude/settings.json` para que la skill de trabajo no pregunte en cada llamada:

```json
{
  "permissions": {
    "allow": [
      "Bash(node *waypoint.cjs*)",
      "ArtifactData",
      "Bash(git status *)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git show *)",
      "Bash(git rev-parse *)",
      "Bash(git merge-base *)",
      "Bash(git ls-files *)",
      "Bash(git worktree list *)",
      "Bash(git branch --show-current)",
      "Bash(git add *)",
      "Bash(git commit *)"
    ],
    "deny": [
      "Bash(git push *)",
      "Bash(git reset --hard *)",
      "Bash(git clean *)",
      "Bash(git -c *)"
    ]
  }
}
```

`ArtifactData` es el nombre con el que las skills de este plugin llaman a la herramienta. Si Claude Code la muestra con otro nombre (por ejemplo `mcp__…__ArtifactData`), usa ese. `deny` manda sobre cualquier `allow`, también sobre el `allowed-tools` de una skill, y cada skill declara solo los comandos git que ejecuta.

- **`git -C <dir> …` queda fuera a propósito**, así que Claude Code la pregunta: la skill de trabajo la usa para actuar sobre el checkout principal desde un worktree (la delegación, la fusión de una fase), y esa pregunta es tu decisión sobre una fusión en él.
- **Con forge**, `"Bash(node *forge.cjs*)"` deja que se ejecute sin que Claude Code pregunte; ponlo en `.claude/settings.local.json` de los proyectos en los que confías, no en tu `~/.claude/settings.json` (forge pregunta él mismo antes de ejecutar los comandos de `.forge/config.yaml`). Con él, añade `"deny": ["Bash(*forge.cjs* hook *)"]`, que impide que Claude llame a mano a los comandos de hook de forge (por ejemplo `hook answer`, que registra tus respuestas) y no toca los hooks reales, porque las reglas de permisos nunca se les aplican. Para que también te pregunte antes de cada integración final y antes de que Claude registre un permiso o tu confianza en esos comandos, añade `"ask": ["Bash(*forge.cjs* swarm merge*)", "Bash(*forge.cjs* local set*)"]`.

## Desarrollo

Desde la raíz del repositorio: `npm install`, `npm test` y luego `npm run build`, que regenera `dist/`, `assets/`, `hooks/register.js` y `types/index.d.ts` (súbelos al repo).

La banda es un mod (`src/mod/register.tsx`, empaquetado en `hooks/register.js`):

- `claude plugin validate plugins/waypoint` comprueba el manifiesto, el módulo de hooks y su contrato de estado.
- `claude plugin test plugins/waypoint` ejecuta `plugins/waypoint/tests/*.test.ts` contra el motor.
- `npm run typecheck:mod` comprueba los tipos de los mods (la banda de waypoint y lens) y sus tests contra los tipos de la API del motor en `types/claude-code/index.d.ts` (ignorado en git); antes corre `mod-types check`, que dice cómo obtenerlos. `npm run mod-types:update` copia ahí la más nueva de las copias que Claude Code escribe al cargar la carpeta de un mod (`claude --plugin-dir plugins/waypoint` escribe `plugins/waypoint/.claude-plugin/types/claude-code/index.d.ts`) y, en un worktree enlazado, la `types/claude-code/` del checkout principal.

Sube la versión en `plugin.json` con cada cambio: la caché de plugins instalados va por versión.
