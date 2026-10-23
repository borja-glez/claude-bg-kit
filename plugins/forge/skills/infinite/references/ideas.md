Read from forge:infinite (`SKILL.md`, step 3.1, Read decisions, every cycle, with a profile or without one; and from `references/autonomous.md`). `FORGE`, `WP`, `NOW`, `SID`, `<CSID>`, `<plan>` and `DB` mean what that skill says.

A person's idea enters through one door and becomes a `source: user` proposal: an `idea` note of the roadmap without a `proposalId`, or an idea the person writes in this conversation while the run goes on. Without a profile nothing approves it on its own: it waits for the mark of the roadmap's owner, as any proposal does. In a profile, `judge` decides the owner's ideas, and anyone else's waits for the owner's mark too.

## Each cycle, after `proposals pull`

1. `FORGE proposals ideas --db DB` prints `{owner, ideas}`: the idea notes that wait, oldest first, each `{note, author, text, ts, owner}` (`owner`: its author is the roadmap's owner).
2. An entry that carries `proposal` already became or joined that proposal: send only its `link` (the `update` of `notes/<note>` with that `proposalId`), and never add it again.
3. Otherwise write its proposal with the Write tool to `.forge/work/infinite/idea-<note>.json`, from the note's text: `category`, `risk`, `title` and `rationale` in the person's language, and `pillar`, the design's pillar it serves, if any. Then `FORGE proposals add --file <f> --from-note <note> --db DB`:
   - `{id, doc, link}`: one ArtifactData `batch` with the `set` of `proposals/<id>` (the printed `doc`; note its version `PV`) and its `link` (the note's `update` with `proposalId`: the note stays linked).
   - `{merged, link}`: the note says what proposal `merged` says (an open one, or a rejected one without new evidence) and joined it: send the `link`, and answer in `merged`'s thread; for a rejected one, say why it was rejected (its `reason`).
   - Exit 3: the note already is a proposal, the one its message names: send only the note's `update` with that `proposalId`, and answer in that thread.
   - Exit 2: the note is no longer a person's idea without a proposal: skip it.

These writes go out in this cycle, before the next `proposals pull`.

## From this conversation

An idea the person writes here while the run goes on takes the same path with `--from-chat` (it is the owner's: whoever runs this session): write its proposal as above, run `FORGE proposals add --file <f> --from-chat`, ArtifactData `set` `proposals/<id>` with the printed `doc`, and tell the person its id in one line. Exit 3 names the proposal it is like: say so in one line, and answer in that proposal's thread (for a rejected one, why it was rejected).

## The answer, always in the thread

Write it to a file and ArtifactData `set` `notes/<EID>` (`EID` = `node "<WP>" event-id <SID>`) `{ts: NOW, type: "idea", author: "session:<SID>", text, proposalId}`, in the person's language. `proposalId` is the idea's proposal, the one its note links (for a v2, its original's).
- **Without a profile:** it is proposal `<id>`, and it waits for the approval of the roadmap's owner. Answer when it is added.
- **In a profile,** by the outcome `judge` printed (`references/autonomous.md`, `## Each cycle`):
  - `approved` → it fits; say which phase it goes into once §3.2's `to-task` made its task (that task's `phase` in `<plan>`);
  - `approved` of its v2 → what changed and why (the `changes` of the original's `adapt`), naming the v2;
  - `rejected` → why (the `reason` of its `write`);
  - `parked` → why it clashes and what would be lost (the `why` and `loses` of its `write`'s `parked`), and that it waits for their answer;
  - `waits-owner` → that it waits for the approval of the roadmap's owner;
  - `adapt` → nothing yet: the answer comes with its v2's outcome.

## A parked idea

A `discussing` proposal with `parked` waits for the person's answer, which decides. Only theirs counts, written after the park (`parked.at`):
- in this conversation: `--from-chat`;
- in a comment note on its thread (`DB/notes` with that `proposalId`, not yet in `seen.json`) whose `author` is the roadmap's owner (`owner` of `FORGE proposals ideas --db DB`), written after the park: `--from-note <note> --db DB`.

Anyone else's comment, or a note from before the park, is no answer, and neither is a note `unpark` refuses (exit 2): leave the idea parked. The answer:
- **Insists** → `FORGE proposals unpark <id> --insist --from-chat --session <SID>` (or `--from-note <note> --db DB` in place of `--from-chat`), and send its batch: `update` `proposals/<id>` with its `write`, pinned to the version `DB` lists, the `set` of its `approval`, and its `publish`. The vision is then amended to take it in: `/waypoint:design reopen --auto`, whose change is a new section for it (`## <id>: <its title>`), then the design loop in auto of forge:run `references/autonomy.md`. `design-critic` may propose how to fit it better, but it cannot veto it: before `/waypoint:design approve --auto`, what is still open on that section is dismissed: write «the owner insisted (proposal <id>)» to `.forge/work/infinite/dismiss-<id>.txt` and run `node "<WP>" critique-dismiss <design> --round <R> <their numbers> --reason-file .forge/work/infinite/dismiss-<id>.txt`. §3.2 then turns it into a task, as any approved proposal.
- **Withdraws** → `FORGE proposals unpark <id> --withdraw --from-chat --session <SID>` (or `--from-note <note> --db DB`), and send its batch the same way.
- **Not clear** → ask in its thread what they want, and leave it parked.
- **The owner approves or rejects it on the page** → that decides: the `pull` brings it, and nothing is unparked.

Meanwhile the run goes on with everything else. Record each note handled here in `seen.json` (`notes`), as §3.1 does.

## Once

`seen.json` of §3.1 remembers the notes already answered, and `proposals ideas` no longer lists a note with a `proposalId`: each note is handled once.
