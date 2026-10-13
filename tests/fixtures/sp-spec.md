# forge: enrutado, mezcla con superpowers y modo autónomo — diseño

**Fecha:** 2026-10-12 · **Estado:** pendiente de revisión · **Plugins afectados:** `forge`, `waypoint`, `lens` · **Repo:** `E:\work\claude-bg-kit` (rama `worktree-forge-route`)
**Origen:** idea I001 de la campaña Reparto. Se hace su recomendación: C (puentes y registro de decisiones) y después B (`forge:route` con autonomía configurable). A (solo una regla inyectada) se descarta.

## 1. Propósito

En la campaña Reparto (E10.0), una petición grande hecha sin decir «forge» cargó `superpowers:brainstorming` y forge no llegó a activarse. Hay tres causas:

- superpowers inyecta en `SessionStart` un bloque imperativo largo. forge solo compite con la descripción de su skill, que pide la palabra «forge».
- No hay puente entre metodologías. El spec y el plan de superpowers no llegan a forge, y el `design.md` y el `plan.yaml` de forge no aprovechan lo que superpowers ya escribió.
- forge pregunta en cada puerta. Cuando decide solo (modo desatendido), lo anota en un ledger que no va a git, y el usuario no ve qué se decidió ni cómo deshacerlo.

Este diseño hace tres cosas, en tres planes que se fusionan por separado:

1. **Registro de decisiones** (§3): un formato único, tres destinos, un resumen final, avisos en lens y en la banda, y `/forge:decisions` para revertir.
2. **Puentes con superpowers** (§4): spec → `design.md`, plan de superpowers → briefs de forge, `tdd: superpowers` y `/forge:review` sobre cualquier rama.
3. **Enrutado y autonomía** (§5): un disparador fuerte (hooks `SessionStart` y `UserPromptSubmit`), la skill `forge:route`, las preferencias `workflow` y `autonomy`, y el modo `auto`, que en el modo infinito llega a diseñar tareas Large.

### Criterios de éxito

- **Disparador:** en la prueba empírica (§5.1), una petición de código Medium o mayor hecha sin nombrar la metodología carga `forge:route` antes que cualquier otra skill de proceso en ≥ 90 % de los prompts, con superpowers instalado y sin él. Una petición Trivial no lo carga.
- **Pregunta de enrutado:** con superpowers instalado, `forge:route` pregunta una sola vez con cuatro opciones, la recomendada primero. Sin superpowers, pregunta forge o sin forge. Con `workflow` fijado o en `auto`, no pregunta y lo dice en una línea.
- **superpowers diseña, forge construye:** el spec de brainstorming acaba en `design.md` (v1, «importado de…») sin reescribirlo, y forge sigue con el planner, el roadmap y la ejecución. `writing-plans` no se ejecuta.
- **superpowers planifica, forge ejecuta:** cada `### Task N` del plan pasa por los validadores, revisores, verify y veredicto de forge, y las casillas del plan se marcan al aceptarse.
- **Modo auto:** una tarea Large pedida en auto llega a «Ejecución terminada» sin más preguntas que las del arranque (§5.5). Cada decisión tomada sola aparece en el ledger, en el roadmap (o en `docs/forge/decisions/`) y en el resumen final con cómo revertirla, y `/forge:decisions revert <n>` la deshace.
- **Infinito con auto:** una tarea Large no se bloquea. Se diseña, se aprueba, se planifica y se trabaja en la rama del infinito.
- **Límites:** nada de la lista «nunca en automático» (§5.5) ocurre sin el usuario.

### Fuera de alcance

- Las propuestas del crítico que se pierden entre rondas (idea I002).
- El lanzador herdr.
- Editar superpowers: su caché se sobrescribe al actualizar.
- Que el infinito decida propuestas fuera de la política de `src/forge/policy.ts`.

## 2. Decisiones tomadas

| Decisión | Elegido |
|---|---|
| Alcance | Toda I001 en tres planes: decisiones → puentes → enrutado y autonomía. El plan 3 necesita el 1 para anotar lo que decide y el 2 para mezclar. |
| Spec importado | Entra como borrador v1. forge recomienda una ronda del crítico, pero se puede aprobar ya. Con `auto` la ronda es obligatoria. |
| Preferencias | `workflow` y `autonomy` van en `.forge/config.yaml` (equipo, en git) y en `.forge/local.yaml` (personal). Orden: lo que dice la petición > `local.yaml` > `config.yaml` > `ask`. |
| Infinito con auto ante una Large | Diseña y aprueba solo, planifica y trabaja, todo en la rama del infinito y anotado (§5.6). |
| «Mixto» | Dos opciones: «superpowers diseña, forge construye» y «superpowers planifica, forge ejecuta». |
| Registro sin roadmap | `docs/forge/decisions/<ámbito>.md`, commiteado con el trabajo, solo si hubo decisiones automáticas. |
| Detección | Siempre, tenga o no superpowers, ante una tarea de código Medium o mayor. Las opciones de superpowers salen solo si está instalado. |
| Integración en auto | Una pregunta al lanzar («¿integro al acabar?», no por defecto), salvo que la petición ya lo diga. Nunca después. |
| Disparador | `SessionStart` + `UserPromptSubmit` + skill `forge:route`, con el texto calibrado por una prueba empírica. |
