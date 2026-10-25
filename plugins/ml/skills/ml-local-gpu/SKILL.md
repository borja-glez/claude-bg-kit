---
name: ml-local-gpu
description: Use when training, fine-tuning, evaluating or exporting models on a local NVIDIA GPU with PyTorch, transformers, trl or peft, running notebooks that use the GPU, publishing models or datasets to Hugging Face, or running ONNX models in the browser with onnxruntime-web, writing a Python script that rewrites many text files or committing Python in a repo whose CI runs ruff format --check; also when torch.cuda.is_available() is False, CUDA runs out of memory, "no kernel image is available" or an sm_120 warning appears, a trl or transformers call rejects a keyword, or a WebGPU session hangs.
---

# ML on a local GPU

## Overview

The GPU, the environment and the APIs are facts of this machine and this lock today, not of memory. Measure before loading the GPU, check an API before calling it, and let the machine rest between long jobs.

## First, read the project

Read `pyproject.toml`, the lock, the CI config and the README before anything else: the project's versions, extras, formatter and helpers win over this skill, which pins no package version.

## Rules

1. **Environment.** Everything runs in the project's uv environment (`uv sync` with its extra, then `uv run ...`) or in a fresh uv one; check it before training with `uv run python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"`. No exceptions: never the global `python` or `pip`, which often carry a torch without CUDA, and not a `venv` plus `pip` "for speed" either.
2. **Torch wheel.** Blackwell (sm_120) needs a torch built for CUDA 12.8 or later: index `https://download.pytorch.org/whl/cu128`; CI and machines without CUDA use `https://download.pytorch.org/whl/cpu`; an older GPU uses whatever wheel the project pins. On Windows the PyPI wheel is CPU only. Symptoms: `torch.cuda.is_available()` False, "no kernel image is available for execution on the device", an `sm_120` warning. Pattern, versions left to the project:
   ```toml
   [project.optional-dependencies]
   cpu = ["torch"]
   cu128 = ["torch"]
   [tool.uv]
   conflicts = [[{ extra = "cpu" }, { extra = "cu128" }]]
   index = [{ name = "pytorch-cpu", url = "https://download.pytorch.org/whl/cpu", explicit = true },
     { name = "pytorch-cu128", url = "https://download.pytorch.org/whl/cu128", explicit = true }]
   [tool.uv.sources]
   torch = [{ index = "pytorch-cpu", extra = "cpu" }, { index = "pytorch-cu128", extra = "cu128" }]
   ```
3. **VRAM.** Run `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader` before launching any GPU job (without `nvidia-smi`, `uv run python -c "import torch; print(torch.cuda.mem_get_info())"` prints free and total bytes), and measure each job's peak in a short pass with `torch.cuda.max_memory_reserved()` plus its CUDA context, or as the rise of `memory.used` during the pass: allocated memory leaves out the allocator cache and the context. No exceptions: the peaks of every job that will run together, plus what other processes already hold, stay under the total minus 10 %, at most three GPU jobs at once, and long jobs (rule 4) alone. "Sequential is safe" is not a measurement: read the free memory first.
4. **Rest.** A long job keeps the GPU heavily loaded for 30 minutes or more. Run `nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader` at its start and end. No exceptions: never two long jobs at once or back to back; leave 15-20 minutes without load between them, spent on free work (docs, notes, reading code). If the temperature cannot be read, say "GPU temperature unavailable" and rest all the same. A deadline, "don't wait for me" or a missing `nvidia-smi` is not a reason to skip it; if two must overlap, say why.
5. **APIs.** Before writing trl, transformers or peft calls, look up the installed version's API: Context7 for its documentation, and the package itself for the signature, e.g. `uv run python -c "import inspect, trl; print(trl.__version__); print(inspect.signature(trl.DPOConfig))"`. No exceptions: the code comes from what they show, never from memory; trl 1.x and transformers 5.x renamed things and arguments. Do not write the script, not even a draft marked "unverified", until the signature output is in front of you; without a shell, give the lookup commands and no script.
6. **Hugging Face.** The model card is in English even when the project is not. Write each milestone's acceptance criterion before training, and the card states the verdict, met or not. No exceptions: the token comes from `HF_TOKEN` or the login, never from a file, a cell or an output. Before publishing, follow the pointer to `hub-publishing` under References.
7. **Notebooks.** Run the whole notebook in the project environment with `uv run jupyter nbconvert --to notebook --execute --inplace <notebook>.ipynb`, then check every figure and claim of the text against the new outputs; cells run by hand are not done.
8. **Line endings.** Python writes every text file with LF and UTF-8: `open(path, 'w', encoding='utf-8', newline='\n')` or `Path(path).write_text(text, encoding='utf-8', newline='\n')`; without `newline`, Windows writes CRLF.
9. **Formatter.** If the CI runs `ruff format --check`, run `uv run ruff format .` and `uv run ruff check .` on your own scripts before every commit. No exceptions: `ruff check` does not format, and a check after the commit is too late.
10. **Validation split.** Split by the unit that leaks (game, user, session, document, conversation), never by row, and deterministically: `GroupShuffleSplit` with `groups=` and a seed, or a hash of the group id.
11. **Browser.** For ONNX or transformers.js in a browser, follow the pointer to `browser-inference` under References. No exceptions: the pointer comes before any worker code.

## Quick reference

| Situation | Do |
|---|---|
| Starting on a project | read `pyproject.toml`, the lock, the CI config and the README first; the project's versions and tools win |
| ONNX or transformers.js in a browser | read `references/browser-inference.md` before any worker code |
| Any Python run | `uv run ...`, never global `python` or `pip` |
| CUDA False, "no kernel image", `sm_120` | cu128 index for Blackwell, cpu index for CI, project's wheel for older GPUs |
| Before a GPU job | `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader` (or `torch.cuda.mem_get_info()`); peaks from `torch.cuda.max_memory_reserved()` plus context; peaks plus memory in use under total minus 10 % |
| Job of 30 minutes or more | alone; 15-20 minutes of rest after; temperature at start and end, or "GPU temperature unavailable" |
| trl, transformers, peft call | Context7 plus `inspect.signature` on the installed package |
| Hugging Face card | English; criterion written before training; verdict published; token from `HF_TOKEN` |
| Notebook commit | `uv run jupyter nbconvert --to notebook --execute --inplace`, then check the text |
| Writing text files | `newline='\n'` and `encoding='utf-8'` |
| CI has `ruff format --check` | `uv run ruff format .` then `uv run ruff check .` before the commit |
| Validation split | `GroupShuffleSplit` by the leaking unit |

## References

When the work runs ONNX or transformers.js models in a browser: Read `references/browser-inference.md` now, and again every time you get here: your memory of it does not survive compaction.
Before publishing a model or a dataset to Hugging Face: Read `references/hub-publishing.md` now, and again every time you get here: your memory of it does not survive compaction.

## Red flags

| Excuse | Reality |
|---|---|
| "a fresh env": `py -3.12 -m venv .venv`, then `pip install` | Use `uv sync` and `uv run`; a plain venv or global pip may bring a CPU-only torch. |
| "Tonight, sequential is the safe choice." | Without reading free VRAM it is a guess; read it and measure the peaks. |
| "the three jobs run back to back ... about 70 minutes of slack before 09:00" | Slack is not rest: 15-20 minutes without load between long jobs. |
| "Waiting would only waste the two-hour window." | The rest is not waste; do free work in it. Without `nvidia-smi`, say "GPU temperature unavailable" and rest. |
| "I wrote it from my memory of `DPOTrainer`" | Look up the installed API first; the code comes from the lookup. |
| "Draft `train_dpo.py`, unverified" | An unverified draft is still memory; give the lookup commands first and write the script after. |
| "in Spanish to match the course" | The card is in English; write the next milestone's criterion before training. |
| "`ruff format --check .` after the script, then commit" | Format your script before the commit with `uv run ruff format .`. |
| "network in parallel (cheap), session creation strictly sequential" | Download, `create` and every `run` go through one serial chain; read the reference. |
