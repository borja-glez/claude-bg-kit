<div align="center">

# 👥 crew

**Dos agentes bajo demanda para las comprobaciones que, si no, haría una persona a mano.**
Uno lee como una persona novata y dice dónde se pierde; el otro juega un prototipo de navegador como un jugador nuevo.

[English](README.md) · **Español** · [← bg-kit](../../README.es.md)

![versión 0.1.0](https://img.shields.io/badge/versi%C3%B3n-0.1.0-89dceb?style=flat-square)

</div>

## Contenido

- [Qué incluye](#qué-incluye)
- [Instalación](#instalación)
- [novice-reader](#novice-reader)
- [playtest-qa](#playtest-qa)
- [Requisitos](#requisitos)

## Qué incluye

crew es solo texto: dos agentes y nada más, sin hooks, sin skills y sin código. Cada uno actúa cuando lo pides por su nombre.

| Agente | Qué hace | Modelo y esfuerzo | Herramientas |
| --- | --- | --- | --- |
| `novice-reader` | Lee un documento, un curso o una página web como una persona novata concreta y cuenta dónde se pierde, con citas exactas y gravedades. Nunca reescribe. | opus, high | Read, Grep, Glob, WebFetch |
| `playtest-qa` | Juega un prototipo de juego de navegador como un jugador nuevo, con teclado y ratón reales en Chrome headless con la GPU, y da cifras por minuto. | opus, medium | Read, Write, Grep, Glob, Bash |

## Instalación

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install crew@bg-kit
```

Se instala con alcance de usuario, que es el de defecto, y no necesita ningún otro plugin de bg-kit. Para apagarlo en un solo proyecto:

```bash
claude plugin disable crew@bg-kit --scope local
```

## novice-reader

Pídelo por su nombre y dale los ficheros o las URL:

> Use the novice-reader agent to read docs/setup.md as a junior Java developer.

Lee como una de tres personas; si no le das ninguna, usa la primera:

- `full-stack developer with no ML` (la de defecto): conoce JS/TS, Node, HTTP, SQL, git y Docker básico, no PyTorch ni el entrenamiento.
- `junior Java developer`: conoce Java, lo básico de Spring Boot, Maven o Gradle y JUnit, no DDD, mensajería ni CI.
- `recruiter`: una persona de selección técnica que no programa y que dedica a una página unos dos minutos.

También puedes describir tu propia persona, y dice qué ha supuesto.

Devuelve un informe con `## Verdict`, `## Findings` y `## Not checked`. Los hallazgos van agrupados en dónde se pierde, términos sin definir, pasos que no puede seguir y lo que se saltaría. Cada uno lleva la cita exacta, su sitio (`path:line`, o `URL § heading` en una página) y una de tres gravedades: `[blocker]`, `[major]` o `[minor]`.

Para una segunda lectura, dale el informe anterior. Añade `## Earlier points` (arreglado, a medias, no) y marca como `seam` lo que dejaron los arreglos: un arreglo que contradice otra parte, o un paso colocado antes de lo que necesita.

Lo que no hace: nunca reescribe, así que recibes el hueco y su sitio y ningún texto de recambio, y nunca ejecuta los pasos que lee. Lo que no pudo verificar sin ejecutar va a `Not checked`.

## playtest-qa

Pídelo por su nombre, con la carpeta del prototipo:

> Use the playtest-qa agent to playtest the prototype in prototypes/forge-lab.

El alcance de defecto es el tutorial y la primera media hora de juego; puedes acotarlo.

Cómo juega:

- Solo entrada real: eventos de teclado y ratón enviados por el navegador (`Input.dispatchKeyEvent`, `Input.dispatchMouseEvent`, o lo mismo con Playwright o Puppeteer), nunca `window.game` ni ninguna función del juego.
- Por tramos de cinco minutos como mucho, cada uno con un Chrome nuevo sobre el mismo perfil y el mismo puerto del servidor, así que el guardado propio del juego se conserva. Si ese puerto está ocupado, el informe dice que el guardado se perdió.
- Chrome headless con `--enable-gpu --use-angle=d3d11 --enable-unsafe-webgpu` (sin el flag de ANGLE fuera de Windows), para que los fotogramas por segundo sean reales. Comprueba qué renderizador le ha tocado y lo dice.

Los navegadores hacen cola: cada uno toma un hueco en `playtest-qa-slots`, en la carpeta temporal del sistema, y hay dos huecos, así que como mucho corren dos navegadores de `playtest-qa` en la máquina. Cuando están los dos ocupados espera, y recupera un hueco cuyo dueño ha muerto. Quien lo lanza no debe poner más de dos a la vez.

Como servidor usa el del proyecto si se resuelve desde la carpeta que le diste; si no, un pequeño servidor estático con los tipos MIME bien puestos (`.js` como `text/javascript`).

Solo detiene los procesos que ha lanzado él, por PID, nunca por nombre.

Qué comprueba: que el tutorial se puede seguir como un jugador nuevo, que siempre hay algo que hacer, que el jugador ve en números si mejora y que el tema explica cada mecánica. Lo que no puede juzgar: sonido, mando y tacto.

El informe lleva `## Verdict`, `## Environment`, `## Tutorial`, `## Per minute` (una fila por minuto), `## Theme`, `## Findings` y `## Not checked`.

## Requisitos

- Claude Code con plugins.
- Para `playtest-qa`: Chrome; Node 22 o posterior si el proyecto no trae Playwright ni Puppeteer; y una GPU para que los fotogramas por segundo valgan (sin ella, lo dice y sigue con la prueba funcional sin contar fps).
