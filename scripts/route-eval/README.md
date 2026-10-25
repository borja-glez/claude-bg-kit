# Prueba empírica del enrutado

Comprueba que una sesión nueva carga `forge:route` antes que cualquier otra skill cuando la petición es trabajo de código Medium o Large, y que no la carga para lo demás: una edición trivial, una pregunta o un mensaje de otro agente. Una petición Small cuenta aparte (abajo, en «Prompts»). El objetivo es, en cada configuración, `forge:route` primero en al menos el 90 % de los prompts que lo esperan y en ninguno de los que esperan `none`.

`run.mjs` monta un repositorio Node pequeño en un directorio temporal (`demo-shop`: un carrito, su índice, un test, un README y los ajustes de npm y git, seis ficheros: con menos de cinco el triaje de forge lo da por vacío y manda todo a Large) y lanza cada prompt de `prompts.json` con `claude -p --output-format stream-json --max-turns 2`. Carga el forge y el waypoint de este checkout con `--plugin-dir` y desactiva, con `--settings`, las copias instaladas de forge, waypoint y lens. De cada sesión lee la primera skill que carga una llamada a `Skill`, los plugins del mensaje `init`, por qué paró (el `subtype` del mensaje `result`) y lo que costó (su `total_cost_usd`). Antes de cada sesión el repositorio vuelve a su primer commit (`git reset --hard` y `git clean -fdx`, salvo `.claude/`), así que lo que una sesión editó, commiteó o dejó en `.forge/` no llega al prompt siguiente ni a otra configuración. Git no busca repositorio por encima de la carpeta de trabajo (`GIT_CEILING_DIRECTORIES`): si una sesión borrara el `.git` del repositorio, la pasada se pararía con un error en vez de limpiar otro repositorio.

## Configuraciones

| Configuración | superpowers | Pista de `UserPromptSubmit` |
|---|---|---|
| `with-superpowers` | instalado | sí |
| `without-superpowers` | desactivado en `<repo>/.claude/settings.local.json` | sí |
| `no-hint` | instalado | no (`FORGE_ROUTE_HINT=off`) |

superpowers se desactiva en los ajustes del propio repositorio de prueba, y no en `--settings`, porque `forge route` y la regla de `SessionStart` leen los `enabledPlugins` del proyecto y nunca el fichero de `--settings`: así la sesión y la CLI ven lo mismo. `no-hint` mide si la pista de una línea ayuda o solo añade falsos positivos. Las dos configuraciones con pista quitan del entorno un `FORGE_ROUTE_HINT` que hayas exportado, que las convertiría en `no-hint`.

El resumen dice en su columna `plugins` si los plugins del mensaje `init` cuadran con la configuración: `contradicts` cuando una sesión lista superpowers donde está desactivado, o no lo lista donde está instalado. Esa configuración no midió lo que dice, y la pasada lo avisa al terminar.

## Prompts

`prompts.json` lleva 20, la mitad en español y la otra mitad en inglés, y cada uno dice lo que se espera (`expected`):
- 4 Medium y 4 Large: `route`, `forge:route` primero;
- 2 Small: `either`, cualquiera de las dos cosas está bien;
- 2 Trivial, 2 preguntas sobre el código y 2 mensajes de otro agente (`<teammate-message …>`): `none`;
- 4 que empujan en contra (`competing`), 2 Medium y 2 Large: `route`. Dos piden hacerlo «directamente, sin planes» (`direct`) y dos piden «usa superpowers:brainstorming» (`brainstorming`), la ruta mixta que el informe de superpowers y gentle-ai vio rota (§3.1).

Los Small van aparte porque las reglas de forge piden cargar `forge:route` para todo lo que pase de una edición trivial (la regla de `SessionStart`, la pista de `UserPromptSubmit` y la descripción de la skill), y `forge:route` se aparta entonces con `stepAside: true`. Una sesión que cumple esas reglas carga `forge:route` en un Small, y una que no la carga tampoco se equivoca. La tabla los cuenta en su propia columna, «Small (either)», que no suma falsos positivos ni cuenta para `PASS`.

Los `competing` también van aparte, en su columna «competing»: no suman a la tasa de `forge:route` ni cuentan para `PASS`, así que el objetivo del 90 % sigue midiendo lo mismo que en octubre. Lo que miden es si `forge:route` sigue saliendo primero cuando la petición o otra skill empujan a saltárselo.

Los Medium nombran a propósito los ficheros que tocan: el triaje de la CLI de forge mide una petición por los ficheros que nombra, y el último test de `tests/route-eval.test.ts` comprueba que da Medium o Large justo a los que esperan `route`. Ese triaje solo corre cuando `forge:route` ya se cargó, así que nombrarlos no ayuda a la medida de la primera skill, pero sí cambia el estímulo respecto a la pasada de octubre.

## Ensayos válidos

Un ensayo es una sesión de un prompt, en una configuración y una repetición: su clave es `<configuración>/<prompt>/<repetición>`, y el resumen cuenta el último ensayo válido de cada clave.

- **Errores del proveedor.** No son ensayos válidos:
  - un `claude` que no arrancó o pasó de los 4 minutos;
  - una sesión sin mensaje `result`;
  - un `result` con `api_error_status`, o con `is_error` y un `subtype` que no es `error_max_turns`.

  No suman a los aciertos, salen en su columna «provider errors» y se repiten al reanudar. Un error de autenticación para la pasada enseguida, y tres seguidos también. `error_max_turns` sí es un ensayo válido: es lo que hace un Trivial que se pone a editar.
- **El hook.** Cada sesión lleva `--include-hook-events`. En `with-superpowers` y `without-superpowers`, una sesión en la que no corrió el hook `UserPromptSubmit` de forge no es válida («no hook») y para la pasada, porque esa configuración no mediría la pista. En `no-hint` el hook corre igual, pero no se exige.

  El stream nombra cada hook solo por su evento: todos los de `UserPromptSubmit` se llaman así, y solo su `hook_id` los distingue. Un hook `UserPromptSubmit` de tus ajustes o de otro plugin parece, pues, el de forge. Las sesiones no se aíslan de esos hooks: quitar los ajustes de usuario quitaría también superpowers, que se activa ahí. En su lugar, `run.mjs` cuenta en cada configuración los hooks `UserPromptSubmit` de fuera de forge:
  - los del `settings.json` de tu carpeta de configuración (`CLAUDE_CONFIG_DIR` o `~/.claude`);
  - los de los plugins instalados que esa configuración deja activos, salvo forge, waypoint y lens, que `--settings` apaga (superpowers no cuenta en `without-superpowers`);
  - los del waypoint de este checkout, que carga `--plugin-dir`.

  Da por ejecutado el de forge solo cuando arrancan más hooks `UserPromptSubmit` distintos (por `hook_id`) que esos. Antes de las sesiones de cada configuración, y también con `--dry-run`, escribe en stderr cuántos cuenta y de dónde salen: compruébalo antes de pagar. No lee los ajustes gestionados (managed settings) ni los plugins integrados (`@builtin`), que no tienen carpeta. Si uno de ellos añade un hook `UserPromptSubmit`, la cuenta se queda corta, y una sesión sin el hook de forge pasaría por válida.

## Uso

```bash
npm run build
node scripts/route-eval/run.mjs --dry-run
node scripts/route-eval/run.mjs [--only <id>] [--config with-superpowers|without-superpowers|no-hint] [--reps <k>] [--resume <fichero>] [--keep]
```

- `--dry-run` imprime los comandos `claude` sin lanzarlos; los de `no-hint` empiezan por `FORGE_ROUTE_HINT=off`. Imprime un comando por sesión pendiente: con `--reps`, uno por repetición; con `--resume`, solo los que faltan.
- `--reps <k>` (de 1 a 10) lanza cada prompt k veces en cada configuración; sin él, una. La tabla da, junto a cada tasa de `forge:route`, su intervalo de Wilson al 95 %.
- `--resume <fichero>` sigue una pasada cortada: lee su `results/<fecha>.jsonl`, lanza solo lo que aún no tiene un ensayo válido (con un `--reps` mayor, también las repeticiones nuevas) y escribe en el mismo fichero. Un fichero que no existe sale con código 2.
- `--only <id>` lanza un solo prompt, en cada configuración.
- `--config <nombre>` lanza una sola configuración. Un `--config` o un `--only` desconocido sale con código 2.
- Cualquier otro argumento (un `--dryrun` mal escrito, por ejemplo), o un `--only` o un `--config` sin valor, sale con código 2 antes de hacer nada.
- `--keep` conserva la carpeta temporal de la pasada (el repositorio `demo-shop` y los ajustes) para inspeccionarla; por defecto se borra al terminar. `--dry-run` no crea nada en disco: los comandos llevan `<work>` en lugar de esa carpeta.

Imprime una línea por sesión con su coste, la tabla y `PASS` o `FAIL`, y termina con código 1 si no llega al objetivo. Una ejecución con `--only` de un prompt que no espera `forge:route` da siempre `FAIL`, porque no lleva ninguno que lo espere. Cada sesión se escribe en `scripts/route-eval/results/<fecha>.jsonl` en cuanto termina, así que una pasada cortada no pierde lo pagado. Al final quedan al lado `<fecha>.json` y `<fecha>.md`, con la tabla; git ignora la carpeta. Una pasada que para antes de acabar imprime `INCOMPLETE`, sale con código 1 y dice la orden que la sigue.

## Coste

Cada pasada llama al modelo y cuesta dinero: lánzala solo cuando quien paga esté de acuerdo. Una completa son 60 sesiones de 2 turnos (20 prompts por 3 configuraciones). La de octubre, de 20 sesiones, costó unos pocos dólares sin que se midiera: calcula entre 2,5 y 3 veces eso. Una sola configuración es un tercio. Desde esta versión cada sesión guarda su `total_cost_usd`, y la tabla suma lo que costó cada configuración: la estimación de la pasada siguiente sale de `results/`. Con `--reps k`, k veces eso. Un error del proveedor o una sesión sin hook también se pagan: cuentan en el coste.

## Qué hacer con el resultado

- Apunta la tabla y el resumen en `## Resultados`, con la fecha.
- Si `no-hint` sale igual o mejor que `with-superpowers` (los mismos aciertos o más y los mismos falsos positivos o menos), propón a la persona poner `route.hint: off` por defecto o retirar la pista. Mientras no se decida, `route.hint` sigue en `on`. La columna de los Small no entra en esa comparación: la pista salta en `s-es` («cambia») y no en `s-en`, y en los dos casos la sesión hace bien. Con repeticiones, mira los intervalos de Wilson: si los de `no-hint` y `with-superpowers` se solapan, la pasada no decide. Apúntala como no concluyente y no cambies `route.hint`; si hace falta decidir, repite con `--reps 2` o `3` y `--resume`.
- La columna `competing` se apunta aparte. Si con `with-superpowers` `forge:route` no sale primero en al menos 3 de los 4, dilo en el resumen: la pista o la regla de `SessionStart` no bastan contra un texto que empuja en contra.

## Resultados

### 13 de octubre de 2026: 10 prompts, dos configuraciones

Esta tabla no se compara con la de una pasada de hoy: tenía 10 prompts, un `demo-shop` de 4 ficheros (el triaje de forge lo daba por vacío) y unos Medium redactados sin nombrar ficheros.

13 de octubre de 2026, dos pasadas y ninguna calibración: el texto de los hooks es el inicial. Las dos pasadas dieron lo mismo. Entre la primera y la segunda, la descripción de `forge:route` ganó la frase «Never in a subagent.». La tabla es la de la segunda pasada, con el texto final.

| prompt | tamaño | idioma | configuración | primera skill | error |
|---|---|---|---|---|---|
| m-es-1 | medium | es | with-superpowers | forge:route |  |
| m-es-2 | medium | es | with-superpowers | forge:route |  |
| m-en-1 | medium | en | with-superpowers | forge:route |  |
| m-en-2 | medium | en | with-superpowers | forge:route |  |
| l-es-1 | large | es | with-superpowers | forge:route |  |
| l-es-2 | large | es | with-superpowers | forge:route |  |
| l-en-1 | large | en | with-superpowers | forge:route |  |
| l-en-2 | large | en | with-superpowers | forge:route |  |
| t-es | trivial | es | with-superpowers | — | exit 1: error_max_turns |
| t-en | trivial | en | with-superpowers | — | exit 1: error_max_turns |
| m-es-1 | medium | es | without-superpowers | forge:route |  |
| m-es-2 | medium | es | without-superpowers | forge:route |  |
| m-en-1 | medium | en | without-superpowers | forge:route |  |
| m-en-2 | medium | en | without-superpowers | forge:route |  |
| l-es-1 | large | es | without-superpowers | forge:route |  |
| l-es-2 | large | es | without-superpowers | forge:route |  |
| l-en-1 | large | en | without-superpowers | forge:route |  |
| l-en-2 | large | en | without-superpowers | forge:route |  |
| t-es | trivial | es | without-superpowers | — | exit 1: error_max_turns |
| t-en | trivial | en | without-superpowers | — | exit 1: error_max_turns |

- with-superpowers: `forge:route` primero en 8/8 Medium y Large (100 %) y en 0/2 Trivial.
- without-superpowers: `forge:route` primero en 8/8 Medium y Large (100 %) y en 0/2 Trivial.
- `PASS`.

En los Trivial la sesión se puso a editar sin cargar ninguna skill y agotó los 2 turnos: eso es el `error_max_turns`. La primera pasada solo mostraba `exit 1`, porque aún no guardaba el `subtype` del mensaje `result`. Se añadió antes de la segunda.

En las dos pasadas, la columna de plugins confirma las dos configuraciones: superpowers aparece solo en `with-superpowers`, y forge y waypoint salen de este checkout.

## Modos mixtos

Una pasada a mano de las cuatro opciones de `forge:route`, de punta a punta. No es un script: cada opción dura decenas de turnos y pregunta cosas. Cuesta como cuatro tareas Medium y tampoco se lanza sin que la persona lo pida.

1. En un repositorio de prueba (el `demo-shop` de `run.mjs` vale), con superpowers instalado y los plugins de este checkout (`claude --plugin-dir plugins/forge --plugin-dir plugins/waypoint`), abre una sesión por opción con una petición que ya nombra el método, para que `forge:route` no pregunte:
   - `forge`: «Con forge: añade un descuento por cupón al carrito…»;
   - `superpowers`: «Con superpowers: añade un descuento por cupón al carrito…»;
   - `superpowers-design`: «superpowers diseña y forge construye: …»;
   - `superpowers-plan`: «superpowers planifica y forge ejecuta: …».
2. En cada una, apunta:
   - si `FORGE route set` deja la etapa que toca en `.forge/route/<sesión>.json` (`handed-off` para `forge`, `designing` para las dos mixtas sin spec ni plan);
   - si el recordatorio de la ruta aparece en el turno siguiente (las dos mixtas);
   - si la entrega a `forge:run` ocurre con `--from-spec` o `--superpowers-plan`, o con las decisiones en `.forge/work/<id>/task.txt` cuando brainstorming toma su camino Bounded y no escribe spec;
   - si `FORGE route stage --stage done` cierra la ruta con el informe final.
3. Apunta el resultado aquí, una fila por opción, con lo que costó cada sesión.
