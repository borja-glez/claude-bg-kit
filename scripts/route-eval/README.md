# Prueba empírica del enrutado

Comprueba que una sesión nueva carga `forge:route` antes que cualquier otra skill cuando la petición es trabajo de código Medium o Large, y que no la carga para una edición trivial. El objetivo es al menos un 90 % de los prompts Medium y Large y ningún Trivial, con superpowers instalado y sin él.

`run.mjs` monta un repositorio Node pequeño en un directorio temporal (`demo-shop`: un carrito, un test y un README) y lanza cada prompt de `prompts.json` con `claude -p --output-format stream-json --max-turns 2`. Carga el forge y el waypoint de este checkout con `--plugin-dir` y desactiva las copias instaladas de forge, waypoint y lens. En la configuración `without-superpowers` desactiva también superpowers. De cada sesión lee la primera skill que carga una llamada a `Skill`, los plugins del mensaje `init` y por qué paró (el `subtype` del mensaje `result`).

`prompts.json` lleva 10 prompts: 4 Medium, 4 Large y 2 Trivial, la mitad en español y la otra mitad en inglés.

## Uso

```bash
npm run build
node scripts/route-eval/run.mjs [--dry-run] [--only <id>]
```

- `--dry-run` imprime los comandos `claude` sin lanzarlos.
- `--only <id>` lanza un solo prompt, en las dos configuraciones.

Una pasada completa son 20 sesiones de 2 turnos y cuesta unos pocos dólares: lánzala solo cuando quien paga esté de acuerdo. Imprime una línea por sesión, la tabla y `PASS` o `FAIL`. Termina con código 1 si no llega al objetivo, y una ejecución con `--only` de un prompt Trivial da siempre `FAIL` porque no lleva prompts Medium ni Large.

Los resultados quedan en `scripts/route-eval/results/<fecha>.json` y `.md`, que git ignora.

## Resultado

13 de octubre de 2026, una pasada, sin calibrar: el texto de los hooks y la descripción de `forge:route` son los iniciales.

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
| t-es | trivial | es | with-superpowers | — | exit 1 |
| t-en | trivial | en | with-superpowers | — | exit 1 |
| m-es-1 | medium | es | without-superpowers | forge:route |  |
| m-es-2 | medium | es | without-superpowers | forge:route |  |
| m-en-1 | medium | en | without-superpowers | forge:route |  |
| m-en-2 | medium | en | without-superpowers | forge:route |  |
| l-es-1 | large | es | without-superpowers | forge:route |  |
| l-es-2 | large | es | without-superpowers | forge:route |  |
| l-en-1 | large | en | without-superpowers | forge:route |  |
| l-en-2 | large | en | without-superpowers | forge:route |  |
| t-es | trivial | es | without-superpowers | — | exit 1 |
| t-en | trivial | en | without-superpowers | — | exit 1 |

- with-superpowers: `forge:route` primero en 8/8 Medium y Large (100 %) y en 0/2 Trivial.
- without-superpowers: `forge:route` primero en 8/8 Medium y Large (100 %) y en 0/2 Trivial.
- `PASS`.

En los Trivial la sesión se puso a editar sin cargar ninguna skill y agotó los 2 turnos: eso es el `exit 1`. La pasada no guardaba aún el motivo, así que se añadió el `subtype` del mensaje `result` y se repitió `t-en`. Con superpowers dio `exit 1: error_max_turns` y sin superpowers terminó en 2 turnos, en los dos casos sin cargar ninguna skill.

La columna de plugins confirma las dos configuraciones: superpowers aparece solo en `with-superpowers`, y forge y waypoint salen de este checkout.
