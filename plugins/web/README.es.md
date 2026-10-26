<div align="center">

# 🌐 web

**Skills de dominio para proyectos web.**
Lo que cada sitio Astro con islas de Preact en Dokploy redescubre si no, escrito una sola vez.

[English](README.md) · **Español** · [← bg-kit](../../README.es.md)

![versión 0.1.0](https://img.shields.io/badge/versi%C3%B3n-0.1.0-94e2d5?style=flat-square)

</div>

## Contenido

- [Por qué web](#por-qué-web)
- [Instalación](#instalación)
- [astro-dokploy-site](#astro-dokploy-site)
- [Cómo se comprueba](#cómo-se-comprueba)

## Por qué web

Todo sitio Astro que sale como imagen de Docker detrás de Dokploy tropieza con lo mismo: un servidor de preview que se va a segundo plano bajo Claude Code, `lhci` que falla en Windows, workers que la CSP bloquea y los campos de los que Dokploy toma su contexto. web lo deja escrito una vez, en una skill que se carga cuando el trabajo llega a ese punto, para que el siguiente sitio no lo redescubra.

## Instalación

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install web@bg-kit
```

Se instala con alcance de usuario (el de por defecto), porque el repo de un sitio no lleva `.claude/`. Para apagarlo en un proyecto, `claude plugin disable web@bg-kit --scope local`: eso escribe tu propio `.claude/settings.local.json`, que no se sube nunca al repo. Reinicia Claude Code después de instalar o actualizar.

## astro-dokploy-site

Se carga cuando trabajas en un sitio Astro estático con islas de Preact, construido con pnpm en una imagen de Docker donde nginx sirve `dist`, desplegado por Dokploy y vigilado por GitHub Actions: los hashes de la CSP y los scripts `is:inline`, Lighthouse y Playwright bajo Claude Code, los workers de Vite que la CSP bloquea, el salto de diseño al hidratar las islas, los componentes de MDX, Prettier o `astro check` fallando en CI, o un build de Dokploy que no encuentra sus ficheros.

| Área | Qué resuelve |
| --- | --- |
| Build e islas | El patrón `mounted`, el `min-height` de las islas, la llamada literal al worker de Vite, la prosa MDX con componentes, pnpm fijado en `packageManager`. |
| CSP | `security.csp` con hashes por página, los scripts `is:inline` con su hash en la config, nada de `<style is:inline>` en las figuras, `worker-src`. |
| Comprobaciones | Prettier como puerta propia, `astro check` con el rango de TypeScript de `@astrojs/check`, el webServer de Playwright bajo Claude Code, Lighthouse en Windows y en CI, Chrome real. |
| Despliegue | El Dockerfile en la raíz, las cabeceras y los tipos MIME de nginx, los campos de ruta y contexto de Dokploy. |
| Higiene del repo | Ni `CLAUDE.md` ni `.claude/` en el repo de un sitio, y las reglas de la skill no se duplican en `AGENTS.md`. |

Las reglas viven en `SKILL.md`, que no pasa de 16 000 bytes para que una compactación lo conserve entero. Cuatro references guardan los procedimientos; cada una se lee al llegar a su momento y otra vez cada vez que se vuelve.

## Cómo se comprueba

- `tests/plugin-web.test.ts` cubre el manifiesto, el solo texto, la higiene, el tope de tamaño, los punteros y los valores que debe llevar cada fichero.
- Los escenarios se ejecutan con y sin la skill (superpowers:writing-skills) cada vez que esta cambia.
