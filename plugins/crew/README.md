<div align="center">

# 👥 crew

**Two on-demand agents for the checks a person would otherwise do by hand.**
One reads as a newcomer and says where they get lost; the other plays a browser prototype as a new player.

**English** · [Español](README.es.md) · [← bg-kit](../../README.md)

![version 0.1.1](https://img.shields.io/badge/version-0.1.1-89dceb?style=flat-square)

</div>

## Contents

- [What's inside](#whats-inside)
- [Install](#install)
- [novice-reader](#novice-reader)
- [playtest-qa](#playtest-qa)
- [Requirements](#requirements)

## What's inside

crew is text only: two agents and nothing else, no hooks, no skills and no code. Each one runs when you ask for it by name.

| Agent | What it does | Model and effort | Tools |
| --- | --- | --- | --- |
| `novice-reader` | Reads a document, a course or a web page as one specific newcomer and reports where they get lost, with exact quotes and severities. Never rewrites. | opus, high | Read, Grep, Glob, WebFetch |
| `playtest-qa` | Plays a browser game prototype as a new player, with real keyboard and mouse input in headless Chrome on the GPU, and reports figures per minute. | opus, medium | Read, Write, Grep, Glob, Bash |

## Install

```bash
claude plugin marketplace add borja-glez/claude-bg-kit
claude plugin install crew@bg-kit
```

It installs with user scope, which is the default, and needs no other bg-kit plugin. To switch it off in a single project:

```bash
claude plugin disable crew@bg-kit --scope local
```

## novice-reader

Ask for it by name and give it the files or URLs:

> Use the novice-reader agent to read docs/setup.md as a junior Java developer.

It reads as one of three personas; with none given it uses the first:

- `full-stack developer with no ML` (the default): knows JS/TS, Node, HTTP, SQL, git and basic Docker, not PyTorch or training.
- `junior Java developer`: knows Java, the basics of Spring Boot, Maven or Gradle and JUnit, not DDD, messaging or CI.
- `recruiter`: a technical recruiter who does not code, who gives a page about two minutes.

You can also describe your own persona, and it says what it assumed.

It returns a report with `## Verdict`, `## Findings` and `## Not checked`. The findings are grouped as where they get lost, undefined terms, steps they cannot follow and what they would skip. Each one carries the exact quote, its place (`path:line`, or `URL § heading` for a page) and one of three severities: `[blocker]`, `[major]` or `[minor]`.

For a second read, give it the earlier report. It adds `## Earlier points` (fixed, partly, not) and marks as `seam` what the fixes left behind: a fix that contradicts another part, or a step placed before what it needs.

What it does not do: it never rewrites, so you get the gap and its place and no replacement text, and it never runs the steps it reads. What it could not verify without running goes to `Not checked`.

## playtest-qa

Ask for it by name, with the folder of the prototype:

> Use the playtest-qa agent to playtest the prototype in prototypes/forge-lab.

The default scope is the tutorial and the first half hour of play; you can narrow it.

How it plays:

- Real input only: key and mouse events sent through the browser (`Input.dispatchKeyEvent`, `Input.dispatchMouseEvent`, or the same through Playwright or Puppeteer), never `window.game` or any game function.
- In segments of at most five minutes, each one a new Chrome on the same profile and the same server port, so the game's own save carries over. If that port is taken, the report says the save was lost.
- Chrome headless with `--enable-gpu --use-angle=d3d11 --enable-unsafe-webgpu` (without the ANGLE flag off Windows), so the frame rates are real. It checks which renderer it got and says so.

Browsers are queued: each takes a slot in `playtest-qa-slots`, in the system temp folder, and there are two slots, so at most two `playtest-qa` browsers run on the machine. When both are busy it waits, and it recovers a slot whose owner is dead. Whoever launches it should not run more than two at a time.

For the server it uses the project's own if one resolves from the folder you gave; otherwise a small static server with the right MIME types (`.js` as `text/javascript`).

It stops only the processes it started, by PID, never by name.

What it checks: that the tutorial can be followed as a new player, that there is always something to do, that the player sees in numbers whether they improve, and that the theme explains each mechanic. What it cannot judge: sound, gamepad and game feel.

The report has `## Verdict`, `## Environment`, `## Tutorial`, `## Per minute` (one row per minute), `## Theme`, `## Findings` and `## Not checked`.

## Requirements

- Claude Code with plugins.
- For `playtest-qa`: Chrome; Node 22 or newer if the project has neither Playwright nor Puppeteer; and a GPU for the frame rates to count (without one, it says so and goes on with the functional test without counting fps).
