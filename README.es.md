<div align="center">

# claude-bg-kit

**Plugins de Claude Code para tareas que no caben en un prompt.**
Diséñalas, planifícalas, constrúyelas con revisión independiente, ejecútalas en paralelo y sigue cada paso en vivo.

[English](README.md) · **Español**

![waypoint 0.10.0](https://img.shields.io/badge/waypoint-0.10.0-cba6f7?style=flat-square)
![forge 0.5.0](https://img.shields.io/badge/forge-0.5.0-fab387?style=flat-square)
![lens 0.5.0](https://img.shields.io/badge/lens-0.5.0-b4befe?style=flat-square)
![Marketplace de Claude Code](https://img.shields.io/badge/Claude%20Code-marketplace%20bg--kit-89b4fa?style=flat-square)
![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A5%2020-a6e3a1?style=flat-square)

</div>

---

## Contenido

- [Qué incluye](#qué-incluye)
- [Cómo encaja todo](#cómo-encaja-todo)
- [Instalación](#instalación)
- [Primeros pasos](#primeros-pasos)
- [Recorrido por las piezas](#recorrido-por-las-piezas)
- [Requisitos](#requisitos)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Desarrollo](#desarrollo)

## Qué incluye

`bg-kit` es un marketplace de plugins de Claude Code con tres plugins. Cada uno sirve por sí solo, y juntos funcionan mejor.

| | Plugin | Qué aporta | Más información |
| --- | --- | --- | --- |
| 🧭 | **waypoint** | Documentos de diseño que se pulen en rondas de crítica, un `plan.yaml` de frentes, fases y tareas, un **roadmap vivo** publicado como artifact de claude.ai y sesiones en paralelo coordinadas sobre worktrees de git. | [plugins/waypoint](plugins/waypoint/README.es.md) |
| 🔨 | **forge** | Una forma de trabajar adaptativa: **triaje por tamaño**, el modelo adecuado para cada papel, primero tus propios validadores, **revisión independiente ponderada**, un **enjambre** de sesiones en paralelo y un **modo infinito** desatendido. | [plugins/forge](plugins/forge/README.es.md) |
| 🔍 | **lens** | Un **panel de progreso en vivo** dentro de Claude Code: roadmap, etapas de forge, ejecuciones de superpowers, pendientes, subagentes, **el modelo y el esfuerzo en uso**, y el **consumo en tokens y dólares** comparado con trabajar sin forge. | [plugins/lens](plugins/lens/README.es.md) |

## Cómo encaja todo

<p align="center">
  <img src="docs/assets/flow.es.svg" alt="El flujo completo: diseño con rondas de crítica, plan y roadmap vivo, el bucle de construcción de forge, un enjambre en paralelo que se integra en main y el modo infinito, con lens y el roadmap observando cada etapa" width="100%">
</p>

Una tarea grande pasa por cuatro etapas. Por el camino tomas tres decisiones: apruebas el diseño, decides las propuestas y autorizas los merges.

1. **Diseño (waypoint).** `/waypoint:design` escribe un documento de diseño. El agente `design-critic` lo revisa por rondas y devuelve propuestas numeradas. Las aplicas, pides otra ronda, haces que Claude te entreviste o lo reescribes. Lo apruebas cuando está bien.
2. **Plan (waypoint + forge).** `forge-planner` convierte el diseño aprobado en `plan.yaml`: **frentes** (líneas de trabajo independientes; *tracks* en inglés), fases y tareas pequeñas y verificables con los ficheros que toca cada una. `/waypoint:plan` lo publica como **roadmap vivo** en claude.ai. Cualquiera con el enlace ve el progreso, escribe notas y decide propuestas allí.
3. **Construir (forge).** `/forge:run` hace el triaje de cada tarea por tamaño y elige un camino. Los caminos más pesados pasan por un implementador elegido según la dificultad, luego por los validadores del propio proyecto (tests, lint, tipos, build) y después por hasta tres revisores independientes (correctness, security, perf). Su veredicto ponderado acepta el trabajo o lo devuelve en una ronda de arreglo, con un modelo más fuerte desde la ronda 3.
4. **En paralelo (enjambre de forge).** Cuando el plan tiene varios frentes desbloqueados, una sesión coordinadora lanza una sesión en segundo plano por frente, cada una en su propio worktree de git, hasta `swarm.parallel` a la vez (5 por defecto). Integra en tu rama el trabajo terminado **de un merge en uno**, pasando los validadores tras cada merge y deshaciéndolo si hay conflicto.

El **modo infinito** (`/forge:infinite`) sigue haciendo ciclos dentro de un presupuesto de ciclos u horas. Un scout propone mejoras con pruebas. Las de bajo riesgo y verificables se aprueban solas y el resto te esperan. Las propuestas aprobadas se convierten en tareas nuevas.

**lens** observa todo el flujo sin gastar tokens: lee los mismos ficheros locales y los eventos de Claude Code. El roadmap enseña ese mismo estado a cualquiera con el enlace.

## Instalación

Añade el marketplace directamente desde GitHub e instala los plugins que quieras:

```bash
claude plugin marketplace add borja-glez/claude-bg-kit

claude plugin install waypoint@bg-kit
claude plugin install forge@bg-kit     # instala waypoint ^0.10.0 como dependencia
claude plugin install lens@bg-kit
```

Dentro de una sesión, `/plugin marketplace add borja-glez/claude-bg-kit` hace lo mismo. Para recibir versiones nuevas más adelante, ejecuta `claude plugin marketplace update bg-kit`.

<details>
<summary><b>Desde un clon local</b> (para trabajar en los propios plugins)</summary>

```bash
git clone https://github.com/borja-glez/claude-bg-kit.git
claude plugin marketplace add ./claude-bg-kit
```

</details>

Reinicia Claude Code después de instalar o actualizar un plugin.

<details>
<summary><b>Permisos recomendados</b> (opcionales, para que las llamadas rutinarias no pregunten)</summary>

Añádelos a `permissions.allow` en `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(node *waypoint.cjs*)",
      "Bash(node *forge.cjs*)",
      "ArtifactData",
      "Bash(git *)"
    ]
  }
}
```

Si Claude Code muestra `ArtifactData` con otro nombre (por ejemplo `mcp__…__ArtifactData`), usa ese. Cada entrada deja que Claude use esa herramienta sin preguntar; quita las que prefieras aprobar a mano.

</details>

## Primeros pasos

**Una funcionalidad grande, de principio a fin:**

```text
/forge:run Añade reintentos de webhooks con backoff exponencial y una cola de mensajes fallidos
```

forge la clasifica como Large, así que empieza con `/waypoint:design`. Itera el diseño con los botones de la banda y apruébalo; forge planifica, publica el roadmap y trabaja las tareas. Con dos o más frentes desbloqueados, los ejecuta en enjambre.

**Solo el roadmap, sin forge:**

```text
/waypoint:design new        # escribir y pulir el diseño
/waypoint:design approve
/waypoint:plan              # plan.yaml + roadmap vivo
/waypoint:work              # tomar tareas una a una
/waypoint:launch api        # una sesión en segundo plano en el frente «api»
```

**Un cambio pequeño:**

```text
/forge:run Renombra getUser a fetchUser en el módulo de auth
```

Se clasifica como Trivial o Small: lo hace la sesión principal o un implementador ligero, lo comprueban los validadores y no se paga revisión.

**Mejora desatendida:**

```text
/forge:infinite --cycles 10
```

**Ver qué está pasando:** `/lens`, o el botón **Panel** de la banda.

## Recorrido por las piezas

### El roadmap vivo (waypoint)

<p align="center"><img src="docs/assets/roadmap.es.svg" alt="Maqueta del roadmap de waypoint con frentes, tareas, línea temporal y sesiones vivas" width="100%"></p>

Un artifact de claude.ai que se actualiza mientras Claude trabaja. Tiene cinco vistas: Seguimiento (por fases o por frentes), Versiones, Sesiones, Notas y Propuestas. También trae filtros, una línea temporal con zoom, una capa de dependencias, un minimapa, exportación y diseño para móvil. Quien tiene acceso escribe notas y aprueba propuestas allí; Claude las lee como información, nunca como órdenes.

### La banda (waypoint)

<p align="center"><img src="docs/assets/band.es.svg" alt="Maqueta de la banda sobre el prompt en los modos diseño, trabajo y enjambre" width="100%"></p>

La banda es una línea sobre el prompt que cambia según lo que estés haciendo. En modo diseño enseña propuestas y puntos críticos; en modo trabajo, tu frente, la tarea en curso y el porcentaje global; en modo enjambre, los frentes vivos y cuántos están integrados. Cada botón ejecuta el comando correspondiente.

### Caminos y agentes de forge

<p align="center"><img src="docs/assets/paths.es.svg" alt="El triaje de forge lleva una tarea al camino Trivial, Small, Medium o Large; la escalera de implementadores y los tres revisores" width="100%"></p>

Lo pequeño sigue siendo barato y lo grande recibe el tratamiento completo. Los implementadores van desde Haiku para el trabajo mecánico hasta Opus con esfuerzo muy alto para lo delicado. Los revisores siempre usan Opus con esfuerzo muy alto, y solo actúan cuando los validadores han pasado.

### El enjambre (forge)

<p align="center"><img src="docs/assets/swarm.es.svg" alt="Una coordinadora lanza sesiones en los frentes desbloqueados, cada una en su worktree, y las integra en main de una en una" width="100%"></p>

### El panel (lens)

<p align="center"><img src="docs/assets/lens.es.svg" alt="El panel de lens con el modelo y el esfuerzo, el roadmap, las etapas de forge, los subagentes y la tarjeta Consumo" width="100%"></p>

## Requisitos

- **Claude Code** con soporte de plugins. La banda y el panel se dibujan en la terminal y en la pestaña Code de la app de escritorio; en el panel de VS Code y con `-p`, usa los comandos directamente.
- **Sesión iniciada en claude.ai**, para los artifacts del roadmap y del diseño.
- **Node.js ≥ 20** y **git**.
- Opcional: el plugin [superpowers](https://github.com/obra/superpowers), cuyos planes y ejecuciones con subagentes también enseña lens.

## Estructura del repositorio

```text
.claude-plugin/marketplace.json   el marketplace bg-kit
plugins/
  waypoint/   skills, agente design-critic, hooks, plantillas del roadmap y del diseño, CLI compilada
  forge/      skills, agentes implementadores, revisores, planificador y scout, hooks, CLI compilada
  lens/       el mod del panel (hooks/register.js) y sus tests contra el motor
src/          fuentes TypeScript: lib/ (compartido), page/ (roadmap), mod/ (banda de waypoint), lens/, forge/
tests/        suites de vitest
docs/
  assets/     las imágenes de los README (las genera art.mjs)
  superpowers/ specs y planes de implementación
build.mjs     compila todos los plugins
```

## Desarrollo

```bash
npm install
npm test                 # vitest
npm run typecheck        # las CLI y las fuentes compartidas
npm run typecheck:mod    # los mods (src/mod, src/lens)
npm run build            # regenera dist/, hooks/ y assets/ de cada plugin; sube el resultado
npm run art              # regenera los SVG de los README en docs/assets

claude plugin validate plugins/<nombre>
claude plugin test plugins/<nombre>
```

Sube la versión del plugin en su `plugin.json` con cada cambio: Claude Code guarda en caché los plugins instalados por versión.
