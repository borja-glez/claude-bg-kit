<div align="center">

# 🧪 ml

**Machine learning on a local GPU, with the measuring done before the training.**
Machine learning on a local NVIDIA GPU: uv environments and CUDA wheels, VRAM and heat budgets, trl and transformers APIs checked against the installed version, leak-free splits, notebooks run whole, Hugging Face cards and in-browser ONNX inference.

**English** · [Español](README.es.md) · [← bg-kit](../../README.md)

</div>

## Contents

- [Why ml](#why-ml)
- [Install](#install)
- [What the skill covers](#what-the-skill-covers)
- [How it loads](#how-it-loads)
- [Requirements](#requirements)
- [Limits](#limits)

## Why ml

Without it, a model reaches for the global Python, which often ships a torch without CUDA, and trains on the CPU without saying so. It stacks long jobs until the machine overheats, sizes batches from memory instead of from free VRAM, writes trl and transformers calls from what it remembers of an API that has since renamed its arguments, splits a validation set by row so the same game or user sits on both sides, and leaves notebooks whose text no longer matches their outputs. ml is one skill that turns each of those into a rule with a command that checks it.

## Install

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install ml@bg-kit
```

Restart Claude Code after installing or updating.

## What the skill covers

- **Read the project first**: `pyproject.toml`, the lock, the CI config and the README win over the skill, which pins no package version.
- **Environment**: everything runs through `uv run`, never the global `python` or `pip`.
- **Torch wheel**: the right index for the GPU or the CI, `https://download.pytorch.org/whl/cu128` or `https://download.pytorch.org/whl/cpu`.
- **VRAM**: `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader` before any job (or `torch.cuda.mem_get_info()` without `nvidia-smi`), and `torch.cuda.max_memory_reserved()` plus the CUDA context for each peak. The peaks of the jobs that run together, plus the memory already in use, stay under the total minus 10 %, with at most three jobs at once.
- **Rest**: a job of 30 minutes or more runs alone, with `nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader` at its start and end, and 15-20 minutes without load after it.
- **APIs**: Context7 and `inspect.signature` on the installed trl, transformers or peft before writing a call.
- **Hugging Face**: cards in English, the acceptance criterion written before training, the token only from `HF_TOKEN` or the login.
- **Notebooks**: `uv run jupyter nbconvert --to notebook --execute --inplace`, then every claim checked against the outputs.
- **Line endings**: `newline='\n'` and `encoding='utf-8'` in every text file Python writes.
- **Formatter**: `uv run ruff format .` and `uv run ruff check .` before the commit when the CI runs `ruff format --check`.
- **Validation split**: `GroupShuffleSplit` by the unit that leaks, never by row.
- **Browser**: ONNX and transformers.js in a browser, with `onnxruntime-web/webgpu`, through a reference read before any worker code.

## How it loads

`ml:ml-local-gpu` loads by itself when the work fits its description, or by hand with `/ml:ml-local-gpu`. Its two references, `browser-inference` and `hub-publishing`, are read when the work gets there. The rules live in the skill itself, so they are still there after a compaction.

## Requirements

- [uv](https://docs.astral.sh/uv/).
- To work on the GPU, the NVIDIA driver, which brings `nvidia-smi`.
- Recommended: Context7, to check the APIs. CPU-only CI is covered too.

## Limits

- It is text only and runs nothing.
- It does not know your card, so the budgets come from `nvidia-smi` at the time.
- It pins no package version: the project's `pyproject.toml`, lock and CI decide.
