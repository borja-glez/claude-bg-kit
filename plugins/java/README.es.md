<div align="center">

# ☕ java

**Las decisiones de un servicio Java y Spring Boot, fijadas una vez.**
Las reglas de DDD y hexagonal de un servicio, el mantenimiento de las librerías Java y un revisor de arquitectura bajo demanda.

[English](README.md) · **Español** · [← bg-kit](../../README.es.md)

![versión 0.1.0](https://img.shields.io/badge/versi%C3%B3n-0.1.0-f9e2af?style=flat-square)

</div>

## Contenido

- [Por qué java](#por-qué-java)
- [Instalación](#instalación)
- [spring-hexagonal-ddd](#spring-hexagonal-ddd)
- [java-oss-library](#java-oss-library)
- [El revisor de arquitectura](#el-revisor-de-arquitectura)
- [Versiones](#versiones)
- [Desarrollo](#desarrollo)

## Por qué java

Cada proyecto de Java te obligaba a redescubrir lo mismo: dónde se publica un evento, qué excepción acaba en un 422, cómo entra un starter nuevo en el build. java fija esas decisiones una vez. Es solo texto: dos skills y un agente, sin hooks, y solo las descripciones de sus dos skills y la del agente ocupan contexto hasta que se usan.

## Instalación

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install java@bg-kit
```

Se instala para tu usuario, en todos los proyectos. Para apagarlo en un proyecto, pon `"enabledPlugins": { "java@bg-kit": false }` en su `.claude/settings.local.json`. No necesita ninguno de los otros plugins.

## spring-hexagonal-ddd

Se carga como `/java:spring-hexagonal-ddd`, o sola cuando Claude ve que su descripción encaja: diseñar, implementar o revisar un servicio Spring Boot con DDD y arquitectura hexagonal, o código que usa spring-boot-cqrs o spring-boot-specification-repository. Es para quien ya conoce DDD: fija decisiones y no enseña.

| Regla | Qué fija |
| --- | --- |
| `core-free` | `domain` y `application` no importan ningún framework; la API de cqrs es la única excepción, y la hora viene de un `Clock` inyectado. |
| `ports-and-layout` | El núcleo llega fuera solo por puertos; los adaptadores traducen y nunca deciden. |
| `aggregates` | Una raíz por frontera de consistencia, que cambia solo por su comportamiento; los value objects son records; una transacción, un agregado. |
| `events-split` | Los eventos de dominio y los de integración, versionados, son familias distintas, unidas por un traductor con un `switch` exhaustivo. |
| `outbox` | Los eventos se anotan en la misma transacción que el cambio, y un relay los publica. |
| `domain-exception` | Todo fallo de negocio es una `DomainException` con nombre y un `code` en kebab-case, que sale como problema RFC 9457. |
| `archunit` | ArchUnit guarda el núcleo, los eventos y la estructura, y un paquete nuevo trae sus reglas en el mismo cambio. |
| `specrepo-reads` | Toda lectura pasa por specification-repository, nunca por un método derivado ni un `@Query`. |
| `idempotent-consumers` | Un consumidor es un `@HandleEvent` con `@Idempotent`, y tolera la entrega desordenada. |
| `business-no` | En un comando remoto, un «no» de negocio es un record de resultado, nunca una excepción. |
| `flyway-immutable` | Una migración aplicada no se edita: un cambio es una `V<n>` nueva. |

Cuando al proyecto le falta lo que nombra una regla (sin outbox, sin specification-repository, una excepción base sin `code`), la skill sigue el mecanismo que el proyecto tiene, nunca construye la pieza que falta dentro de una tarea de feature, y dice una vez en su informe qué regla no pudo aplicarse.

Seis references (DDD táctico, estructura hexagonal, cqrs y specification-repository, mensajería y outbox, persistencia y Flyway, tests) se leen cuando el trabajo llega a ellas, no de entrada. La skill ordena leer cada una en ese momento y otra vez cada vez que vuelve, porque su recuerdo no sobrevive a la compactación.

## java-oss-library

Se carga como `/java:java-oss-library`, o sola ante trabajo en spring-boot-cqrs, spring-boot-specification-repository o una librería construida igual. Remite al `AGENTS.md` del repositorio, que sigue siendo el contrato de cada sesión, y añade solo lo que ese fichero no tiene: cómo cambia el build (`build-logic`, nunca el fichero de un módulo), a qué listas se añade un módulo nuevo, los dos starters de Boot, la cobertura del 100 %, el release a Maven Central, las issues `agent-ready` y `needs-design`, el tren de merges tras un squash y mantener `docs/superpowers` fuera de `main`.

## El revisor de arquitectura

Se llama con `@agent-java:architecture-reviewer`, o pidiéndolo: «revisa la arquitectura de esta rama». Es bajo demanda y no un revisor de forge: nada lo ejecuta por sí solo.

Lee el diff de una rama (o un fichero de diff) contra las reglas de arriba, los ficheros enteros y no solo los hunks, y ejecuta ArchUnit (`*ArchitectureTest*`) o, si el proyecto no tiene, `./gradlew quality`. Nunca ejecuta lo que necesita Docker. Su informe tiene una forma fija:

```text
rules: spring-hexagonal-ddd
tests: <command> → <passed | N failed: <test names>> | not run: <reason>
findings:
- [<critical|important|minor>] <file>:<line> `<rule id>` — <what breaks the rule> → <the change that fixes it>
pre-existing (outside the diff, at most 5):
- <file>:<line> `<rule id>` — <one line>
not applicable: <rule ids and why, in one line, or none>
verdict: <clean | changes needed>
```

Es de solo lectura (Read, Grep, Glob y Bash; no tiene herramienta para editar), corre en `opus` con `effort: high`, y lleva precargada la skill `spring-hexagonal-ddd` mediante `skills:` con el nombre calificado por el plugin, `java:spring-hexagonal-ddd`, una forma comprobada en una sesión real. Si las reglas no llegan, toda su respuesta es `rules not loaded`.

## Versiones

Ninguna versión se fija en las skills ni en el agente. Se leen del `gradle/libs.versions.toml` del proyecto, o de Context7 si una API es dudosa.

## Desarrollo

- `plugins/java/.claude-plugin/plugin.json`, las dos skills en `skills/` (cada una con sus `references/`) y `agents/architecture-reviewer.md`.
- `npx vitest run tests/java-plugin.test.ts` comprueba el manifiesto, el frontmatter, los tamaños, las reglas y los README.
- `claude plugin validate plugins/java` comprueba el manifiesto y los componentes.

Sube la versión en `plugin.json` en cada cambio: la caché del plugin instalado se indexa por versión.
