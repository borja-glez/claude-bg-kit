<div align="center">

# 🧪 ml

**Machine learning en una GPU local, midiendo antes de entrenar.**
Machine learning en una GPU NVIDIA local: entornos uv y ruedas de CUDA, presupuesto de VRAM y de calor, las APIs de trl y transformers comprobadas contra la versión instalada, particiones sin fugas, notebooks ejecutados enteros, cards de Hugging Face e inferencia ONNX en el navegador.

[English](README.md) · **Español** · [← bg-kit](../../README.es.md)

</div>

## Contenido

- [Por qué ml](#por-qué-ml)
- [Instalación](#instalación)
- [Qué cubre la skill](#qué-cubre-la-skill)
- [Cómo se carga](#cómo-se-carga)
- [Requisitos](#requisitos)
- [Límites](#límites)

## Por qué ml

Sin ella, un modelo tira del Python global, que a menudo trae un torch sin CUDA, y entrena en la CPU sin decirlo. Apila trabajos largos hasta que el equipo se calienta, dimensiona los lotes con la memoria que cree recordar en vez de con la VRAM libre, escribe llamadas de trl y transformers de memoria sobre APIs que ya han cambiado el nombre de sus argumentos, parte la validación por filas y deja la misma partida o el mismo usuario a los dos lados, y deja notebooks cuyo texto ya no cuadra con sus salidas. ml es una sola skill que convierte cada uno de esos fallos en una regla con una orden que la comprueba.

## Instalación

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install ml@bg-kit
```

Reinicia Claude Code tras instalar o actualizar.

## Qué cubre la skill

- **Leer antes el proyecto**: mandan el `pyproject.toml`, el lock, la CI y el README, no la skill, que no fija versiones de paquetes.
- **Entorno**: todo se ejecuta con `uv run`, nunca con el `python` ni el `pip` globales.
- **Rueda de torch**: el índice que toca para la GPU o la CI, `https://download.pytorch.org/whl/cu128` o `https://download.pytorch.org/whl/cpu`.
- **VRAM**: `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader` antes de cada trabajo y `torch.cuda.max_memory_allocated()` para cada pico, con un margen del 10 % y como mucho tres trabajos a la vez.
- **Descanso**: un trabajo de 30 minutos o más va solo, con `nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader` al empezar y al acabar, y 15-20 minutos sin carga después.
- **APIs**: Context7 e `inspect.signature` sobre el trl, transformers o peft instalado antes de escribir una llamada.
- **Hugging Face**: cards en inglés, el criterio de aceptación escrito antes de entrenar y el token solo desde `HF_TOKEN` o el login.
- **Notebooks**: `uv run jupyter nbconvert --to notebook --execute --inplace`, y luego cada afirmación contrastada con las salidas.
- **Finales de línea**: `newline='\n'` y `encoding='utf-8'` en cada fichero de texto que escribe Python.
- **Formateador**: `uv run ruff format .` y `uv run ruff check .` antes del commit cuando la CI ejecuta `ruff format --check`.
- **Partición de validación**: `GroupShuffleSplit` por la unidad que provoca la fuga, nunca por fila.
- **Navegador**: ONNX y transformers.js en un navegador, con `onnxruntime-web/webgpu`, mediante una reference que se lee antes de cualquier código de worker.

## Cómo se carga

`ml:ml-local-gpu` se carga sola cuando el trabajo encaja con su descripción, o a mano con `/ml:ml-local-gpu`. Sus dos references, `browser-inference` y `hub-publishing`, se leen cuando el trabajo llega a ellas. Las reglas viven en la propia skill, para que sigan ahí tras compactar.

## Requisitos

- [uv](https://docs.astral.sh/uv/).
- Para trabajar en la GPU, el driver de NVIDIA, que trae `nvidia-smi`.
- Recomendado: Context7, para comprobar las APIs. La CI de solo CPU también está cubierta.

## Límites

- Es solo texto y no ejecuta nada.
- No conoce tu tarjeta, así que los presupuestos salen de `nvidia-smi` en el momento.
- No fija versiones de paquetes: deciden el `pyproject.toml`, el lock y la CI del proyecto.
