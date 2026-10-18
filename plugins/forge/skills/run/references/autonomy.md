# Autonomy

Read from forge:run (`## Autonomy` in `SKILL.md`). `FORGE` and `WP` mean what that skill says.

forge asks at its gates unless autonomy is `auto`. It is `auto` when `FORGE prefs` resolves `autonomy: auto` (`.forge/local.yaml` over `.forge/config.yaml`), with `/forge:run --auto`, or when the request says so ("en automático", "sin preguntarme", "modo auto", "on auto", "without asking"); a request that asks to be asked wins the other way (`FORGE prefs --autonomy ask`). Auto is `### Unattended` (`references/execution.md`) from the start, plus approving the design and the plan:
- **Record it:** `FORGE triage --autonomy auto …` in `## 1. Triage` (`SKILL.md`), and `FORGE swarm start --autonomy auto …` in `references/execution.md` step 1.
- **Questions only at launch,** all in one message (AskUserQuestion), and none after:
  - changes in the tree that are not the task's (never automated: commit, stash or leave them, as `Rules for every path` in `SKILL.md` says);
  - on the Large path, the final merge: run `FORGE authorize merge-on-finish --branch <rama> --locale <es|en>` (no run exists yet, so forge ties the answer to this session) and ask its `ask` exactly as printed, also when the request already says «… e intégralo al acabar» (only a recorded answer authorizes); its yes becomes `--merge-on-finish` in `references/execution.md` step 1, which then does not ask again;
  - in infinite mode: the budget, as always.
- **Any other doubt** becomes a question note on the roadmap (or a line of the final report without one), and the work takes the safe path of the `### Unattended` table (`references/execution.md`).
- **What auto decides alone**, each recorded with `FORGE decision add` (`"by": "auto"`, as `references/decisions.md` says):

| Point | Decision | `undo` |
|---|---|---|
| `route` | the `recommended` option of `FORGE route` (`forge:route` records it) | `none` (discard the branch or start the task again) |
| `triage` | raising the path; the ratchet only goes up | `none` |
| `design-apply` | after a critique round, apply its `critical` and `major` proposals (in a verification, its `critical` ones); the `minor` ones are dismissed with the reason `auto: minor` | `git-revert` of the design commits |
| `design-approve` | approve when `waypoint design-gate` prints `canAutoApprove: true` (nothing critical or major pending, no applied change the critic has not read) | `design-reopen` |
| `plan-confirm` | confirm the planner's phase outline | `plan-edit` with the new task ids |
| `mode` | the mode and N that `FORGE swarm propose` recommends | `none` |
| `ruling` | with blocking findings (`breaker` or `stalled`): a ruling, the task blocked with a question note, and the other tasks go on | `none` |

- **The design loop in auto** (`references/large.md` step 1, and `/forge:infinite` after it reopens the design). `<design>` is `docs/waypoint/<project>/design.md`.
  1. `/waypoint:design round --auto`: the first round reviews everything (after a reopen, what changed), with the full budget. Then `/waypoint:design apply <the numbers of its critical and major proposals> --auto` and record `design-apply` (`undo` `git-revert` from the commit before the apply to the one after; the critique has its own commit before it). When it had `minor` proposals, write `auto: minor` to `.forge/work/<project>/dismiss-reason.txt` and run `node "<WP>" critique-dismiss <design> --round <R> <their numbers> --reason-file .forge/work/<project>/dismiss-reason.txt`, so they do not stay pending.
  2. When step 1 applied anything, `/waypoint:design round --verify --auto`: the critic reads only what changed, with at most 3 critical proposals (a hand edit, the gate's `handEdit`, is snapshotted first by that `round`, so the verification reads it too). With `verdict: ready`, go to step 4.
  3. With `verdict: changes`, apply its critical proposals (`/waypoint:design apply r<R>:<numbers> --auto`, recorded as `design-apply`) and verify again: at most 3 rounds in all, the first one included. When the third round's verdict is still `changes`, apply nothing (the gate would refuse an unread change) and stop as in step 4.
  4. `/waypoint:design approve --auto`, which approves only when `waypoint design-gate` allows it (nothing critical or major pending, no applied change the critic has not read); record `design-approve`. When `critical` proposals remain after 3 rounds, or the gate still refuses, stop the task with a question note «el diseño necesita tu decisión» that lists them: the design stays a draft. Under `/forge:infinite` the task is also blocked, and a later pass never reopens that design nor works the task (its §3.3 **Large triage**, steps 1 and 2).
- **Never in auto, at any level:** merging into `main` or the default branch without the launch answer; pushing; deleting branches or files; publishing beyond the private roadmap (also making it internal for the evidence); committing, stashing or discarding changes that are not the task's; surface permissions and their changes; starting infinite mode without a budget; closing escalations; deciding proposals outside the policy.
- **Branches:** Large works on `forge/run-<project>` and the design commits go to the current branch, as always; Medium and Small work on the current branch, as in ask mode (each brief leaves a `base..HEAD` range that can be reverted).
