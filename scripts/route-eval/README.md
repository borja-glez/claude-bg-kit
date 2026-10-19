# Prueba empírica del enrutado

Comprueba que una sesión nueva carga `forge:route` antes que cualquier otra skill cuando la petición es trabajo de código Medium o Large, y que no la carga para lo demás: una edición trivial o pequeña, una pregunta o un mensaje de otro agente. El objetivo es, en cada configuración, `forge:route` primero en al menos el 90 % de los prompts que lo esperan y en ninguno de los demás.

`run.mjs` monta un repositorio Node pequeño en un directorio temporal (`demo-shop`: un carrito, un test y un README) y lanza cada prompt de `prompts.json` con `claude -p --output-format stream-json --max-turns 2`. Carga el forge y el waypoint de este checkout con `--plugin-dir` y desactiva, con `--settings`, las copias instaladas de forge, waypoint y lens. De cada sesión lee la primera skill que carga una llamada a `Skill`, los plugins del mensaje `init`, por qué paró (el `subtype` del mensaje `result`) y lo que costó (su `total_cost_usd`).

## Configuraciones

| Configuración | superpowers | Pista de `UserPromptSubmit` |
|---|---|---|
| `with-superpowers` | instalado | sí |
| `without-superpowers` | desactivado en `<repo>/.claude/settings.local.json` | sí |
| `no-hint` | instalado | no (`FORGE_ROUTE_HINT=off`) |

superpowers se desactiva en los ajustes del propio repositorio de prueba, y no en `--settings`, porque `forge route` y la regla de `SessionStart` leen los `enabledPlugins` del proyecto y nunca el fichero de `--settings`: así la sesión y la CLI ven lo mismo. `no-hint` mide si la pista de una línea ayuda o solo añade falsos positivos.

## Prompts

`prompts.json` lleva 16, la mitad en español y la otra mitad en inglés, y cada uno dice lo que se espera (`expected`):
- 4 Medium y 4 Large: `route`, `forge:route` primero;
- 2 Trivial, 2 Small, 2 preguntas sobre el código y 2 mensajes de otro agente (`<teammate-message …>`): `none`.

## Uso

```bash
npm run build
node scripts/route-eval/run.mjs --dry-run
node scripts/route-eval/run.mjs [--only <id>] [--config with-superpowers|without-superpowers|no-hint]
```

- `--dry-run` imprime los comandos `claude` sin lanzarlos; los de `no-hint` empiezan por `FORGE_ROUTE_HINT=off`.
- `--only <id>` lanza un solo prompt, en cada configuración.
- `--config <nombre>` lanza una sola configuración.

Imprime una línea por sesión con su coste, la tabla y `PASS` o `FAIL`, y termina con código 1 si no llega al objetivo. Una ejecución con `--only` de un prompt que no espera `forge:route` da siempre `FAIL`, porque no lleva ninguno que lo espere. Los resultados quedan en `scripts/route-eval/results/<fecha>.json` y `.md`, que git ignora.

## Coste

Cada pasada llama al modelo y cuesta dinero: lánzala solo cuando quien paga esté de acuerdo. Una completa son 48 sesiones de 2 turnos (16 prompts por 3 configuraciones). La de octubre, de 20 sesiones, costó unos pocos dólares sin que se midiera: calcula entre 2,5 y 3 veces eso. Una sola configuración es un tercio. Desde esta versión cada sesión guarda su `total_cost_usd`, y la tabla suma lo que costó cada configuración: la estimación de la pasada siguiente sale de `results/`.

## Qué hacer con el resultado

- Apunta la tabla y el resumen en `## Resultados`, con la fecha.
- Si `no-hint` sale igual o mejor que `with-superpowers` (los mismos aciertos o más y los mismos falsos positivos o menos), propón a la persona poner `route.hint: off` por defecto o retirar la pista. Mientras no se decida, `route.hint` sigue en `on`.

## Resultados

### 13 de octubre de 2026: 10 prompts, dos configuraciones

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
