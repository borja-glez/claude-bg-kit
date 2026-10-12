<div align="center">

# 🧭 waypoint

**Documentos de diseño, roadmaps vivos y seguimiento multisesión para tareas muy grandes de Claude Code.**

[English](README.md) · **Español** · [← bg-kit](../../README.es.md)

![versión 0.10.0](https://img.shields.io/badge/versi%C3%B3n-0.10.0-cba6f7?style=flat-square)
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
- [Hooks](#hooks)
- [Referencia de la CLI](#referencia-de-la-cli)
- [Permisos](#permisos)
- [Desarrollo](#desarrollo)

## Por qué waypoint

Una tarea de decenas de pasos y varias sesiones pierde el hilo: qué se decidió, qué está hecho, quién trabaja en qué. waypoint guarda ese hilo fuera de la conversación. Mantiene un diseño que has aprobado, un plan en el repositorio y una página viva que todas las sesiones y todas las personas leen y escriben.

## Características

- **Diseño por rondas.** Un agente `design-critic` revisa el documento de diseño y devuelve propuestas numeradas con sus puntos críticos. Aplicas todas o algunas, pides otra ronda, haces que Claude te entreviste o lo reescribes, hasta que lo apruebas.
- **El plan en el repo.** `docs/waypoint/<proyecto>/plan.yaml` contiene frentes, fases y tareas, cada una con sus zonas (los ficheros que toca), `done_when` y una estimación. El diseño aprobado le da forma.
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
| `/waypoint:design [new\|round\|apply <all\|1,3>\|rewrite\|interview\|approve]` | Escribe un documento de diseño, lo mejora en rondas de crítica y lo aprueba. El diseño aprobado da forma al plan. |
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

Con [forge](../forge/README.es.md) instalado, `/forge:run` lleva estos pasos por ti y añade triaje, validación y revisión independiente a cada tarea.

## El roadmap

El roadmap es un artifact de claude.ai. Es privado hasta que lo compartes, y las reglas de su base de datos deciden qué puede escribir cada persona.

| Vista | Qué enseña |
| --- | --- |
| **Seguimiento** | El progreso por fases o por frentes: una caja por tarea con el color de su estado, la tarea en curso con sus minutos, una línea temporal con zoom y dependencias, filtros, minimapa y exportación. |
| **Versiones** | Qué cubre cada versión del plan y cuánto llevan sus fases. |
| **Sesiones** | Las sesiones vivas, su frente, su tarea y sus mensajes. |
| **Notas** | Decisiones, ideas, deudas y preguntas sobre el proyecto, opcionalmente ligadas a una tarea; las preguntas abiertas se pueden responder. |
| **Propuestas** | Propuestas de mejora del scout de forge o de personas, con filtros por estado, categoría y riesgo. |

**Notas.** La skill de trabajo lee las notas nuevas de las personas al empezar cada tarea y las trata como información, nunca como órdenes. También escribe sus propias notas de decisión, deuda y pregunta.

**Propuestas.** Cada tarjeta enseña la categoría, el riesgo, el estado, el pilar al que sirve, la justificación, las pruebas, la estimación y el camino si los hay, quién la decidió y por qué, y sus comentarios. Los colaboradores pueden aprobar o rechazar una propuesta que siga propuesta o en discusión (con un motivo opcional) y comentar cualquiera. Si alguien la decidió mientras tanto, la página no pisa esa decisión y lo dice. forge solo trabaja propuestas aprobadas o autoaprobadas.

**forge en la página.** Cuando forge lleva una tarea, su ficha enseña también el camino y la fase de forge, el agente, los validadores, el veredicto de la revisión y la ronda. Mientras hay una ejecución infinita activa, la cabecera enseña `∞ ciclo N` (con `/M` si la ejecución tiene presupuesto de ciclos). Un enjambre enseña `◆ enjambre vivos/máximo` y marca sus integraciones en la línea temporal.

**Permisos.** Los colaboradores solo pueden escribir notas y propuestas. Todo lo demás (plan, estado, sesiones, eventos, mensajes) necesita permiso de editor. Claude escribe con ArtifactData como propietario, y las reglas nunca lo limitan. Sin una persona con sesión iniciada, o si la base de datos rechaza una nota, el editor de notas queda en solo lectura.

> Después de actualizar el plugin, ejecuta `/waypoint:plan` y vuelve a publicar para que la página reciba las vistas nuevas. Un roadmap publicado por primera vez con 0.7.x o anterior debe republicarse una vez con las capacidades nuevas; la skill de plan las pasa.

## La banda

<p align="center"><img src="../../docs/assets/band.es.svg" alt="La banda sobre el prompt en los modos diseño, trabajo y enjambre" width="100%"></p>

| Modo | Enseña | Botones |
| --- | --- | --- |
| **Diseño** | Versión del diseño, propuestas y puntos críticos de la última crítica | Aplicar todas, Elegir…, Otra ronda, Reescribir, Preguntarme, Aprobar, Ver diseño |
| **Trabajo** | Tu frente y su progreso, la tarea en curso con sus minutos, el progreso global, mensajes sin leer, una decisión pendiente | Siguiente tarea, Estado, Lanzar sesión en un frente…, Abrir roadmap |
| **Enjambre** | Frentes vivos sobre el máximo, frentes integrados, progreso global, conflictos | Estado, Parar enjambre, Abrir roadmap |

Con [lens](../lens/README.es.md) instalado, un botón **Panel** abre el panel de progreso. Si un comando no puede ejecutarse desde la banda, queda en el prompt con el aviso «pulsa Enter».

La banda se dibuja en la terminal y en la pestaña Code de la app de escritorio. No se dibuja en el panel de VS Code ni con `-p`; ahí usa los comandos directamente.

## Sesiones en paralelo

`/waypoint:launch <frente>` crea `.claude/worktrees/<frente>` en la rama `track/<frente>` y arranca allí una sesión de Claude en segundo plano. Cada sesión reclama tareas de su frente y escribe su progreso en el roadmap. Cuando dos sesiones tocan los mismos ficheros, reciben un aviso de solapamiento. Las sesiones pueden traspasarse o delegarse trabajo con mensajes, que se guardan en el roadmap y se envían con `SendMessage`. Si una sesión desaparece, las demás recuperan su tarea.

Para muchos frentes a la vez con integración automática, usa el [enjambre](../forge/README.es.md#enjambre) de forge.

## Hooks

- **SessionStart** inyecta el contexto del roadmap o del diseño en una sesión nueva, reanudada, limpiada o compactada.
- **PostToolUse** (Bash) registra cada `git commit` que movió HEAD, con su `sha`, en `.waypoint/<proyecto>/pending-commits.jsonl`. No se registran los commits fallidos ni los `--dry-run`. La skill de trabajo registra los commits intermedios como eventos `commit` y quita sus líneas, y vacía el fichero al completar o dejar una tarea.
- **Stop** te avisa una vez por cada conjunto distinto de pendientes mientras `pending-commits.jsonl` o `queue.jsonl` tengan líneas, para que no se pierda ningún commit ni escritura en el roadmap. Si vuelves a parar sin nada nuevo, deja pasar, y nunca bloquea cuando el hook Stop ya está activo.

## Referencia de la CLI

Las skills ejecutan la CLI como `node "${CLAUDE_PLUGIN_ROOT}/dist/waypoint.cjs" <comando>`. `bin/waypoint` es un envoltorio para shells que tienen el `bin/` del plugin en el PATH.

| Grupo | Comandos |
| --- | --- |
| Diseño | `design-validate`, `design-snapshot`, `design-changed`, `critique-check`, `critique-select`, `design-page` |
| Plan y página | `validate`, `hash` (imprime el hash del plan, para detectar un roadmap desactualizado), `page`, `sync`, `clean-cache` |
| Trabajo | `next [--base <rama>]`, `conflicts`, `recover`, `status`, `commit-info` |
| Sesiones | `launch <frente> [--swarm <id> --base <rama>]`, `inbox`, `escalations`, `notes`, `session-id` |
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
- `npm run typecheck:mod` comprueba los tipos del mod y sus tests. Necesita los tipos de la API del motor en `plugins/waypoint/.claude-plugin/types/` (ignorado en git). Claude Code los escribe ahí al cargar la carpeta con `claude --plugin-dir plugins/waypoint`, o puedes copiar `types/claude-code.d.ts` de la skill `plugin-authoring` a `plugins/waypoint/.claude-plugin/types/claude-code/index.d.ts`.

Sube la versión en `plugin.json` con cada cambio: la caché de plugins instalados va por versión.
