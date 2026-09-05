---
name: brainstorm
description: Shape a vague idea into a buildable direction through dialogue — checks whether it is one idea or several, offers 2–3 competing approaches with trade-offs and a recommendation, and converges on a design stated in plain words. Use when the user has a rough idea, wants to think through a feature before planning it, or asks to brainstorm. Exits either to "just build it" (nothing written) or to a rough-notes file handed to the `plan` skill.
allowed-tools: Bash, Read, Write, Grep, Glob
---

# lightsout: brainstorm

**This skill is an interactive conductor, not the engine.** It holds zero
deterministic decisions — no gates, retries, caps, state, or contract parsing.
It runs exactly one engine subcommand, `ticket-state`, and only when the idea
traces to a ticket; it still holds no deterministic decision of its own, and it
never reads back what it writes. Triggering is gentle: the description above is
the only trigger — no hook, no forced invocation. Writing the settled-decisions
file below changes nothing about this standing — the skill never reads the file
back; the engine validates it at draft time.

## Question format

**Pick the shape from what the answer is.** Before writing the question,
ask: does answering it mean inventing a name or a short phrase the code or
the user will see — a value, a state, a field, a flag, a message? Two or
more of them: draft the real names as a table under **Options**, one row
each, first column the name, second column a short description of what that
thing is. Exactly one: write the drafted wording out inline, in full, rather
than describing it. Any other question stays prose. The labeled parts below
apply either way — this test only decides whether the names get written down
or talked about, and the 1–3 sentence target counts sentences, not table
rows.

Every question this skill puts to the user uses this labeled four-part
shape, in this order:

**Context:** what the question is about and why it matters, in everyday
words. Write for someone who has not read the plan or the code — never
assume they know the plan's internals. State the problem the question
decides — in everyday words — before naming any options.

**Question:** the question itself, one sentence.

**Options:** the answers to choose between, one per line, each opening with a
bracketed number and its name — `(1) <name>: …` — then what it wins and what it
costs. The number is there so the user can reply with the digit alone; the name
is what makes the list readable to someone who skipped the paragraphs above.
When an option carries risk, say what goes wrong if it fails and what catches
it.

**Recommendation:** the option you recommend, named by its number, and the
one-line why — so a reply of just that number resolves it.

**Presentation.** Each labeled part is its own short paragraph — bold label,
blank line between parts. No bullet dashes on the labels; the blank lines
are what keep the block readable.

**Extra parts are welcome when needed.** If something the user must know
fits none of the four labels (a safety note, a cost, a deadline effect),
add another bold-labeled paragraph rather than forcing it in or leaving
it out.

**Plain language, always.** No jargon. Never use an internal name — a file,
symbol, subcommand, or engine term — without saying what it means in
everyday words. If the reader would need to open a file to answer, the
question is not ready to ask.

**A label reads like a well-named variable.** Someone who skips straight to
the options knows what each one is from the label alone — nothing borrowed
from the paragraphs above it or from its place in the list. `needs-a-human`
passes; "Not true" and "the third one" do not. When the question is about
which action to take, name each option by what it does ("copy the file each
run", "keep the first copy"). When the question asks you to invent a name,
the drafted name itself is the label. An internal name never appears in a
label, even one explained earlier in the question — the label names what
the option does in everyday words (`checker-per-plan-file`, not
`fourth-lens`).

**Keep each part short.** Aim for 1–3 plain sentences per label. When a
question outgrows that, treat it as a sign it is really two questions —
split it.

**One question at a time is the default here** — brainstorm conversations
are exploratory, not batched.

**Durable question delivery.** A pending decision is the deliverable for that
turn. Put the complete four-part question block in the final response that
waits for the user's answer. Never put the full block in commentary and then
summarize or repeat only its Question in the final response; commentary may
report progress, but must not contain a decision the user needs to answer.

Never put a question to the user through an option-picker tool — the kind that
shows a list of one-line choices to select from. Every question in this phase
is written out in that final response, in the shape above. A picker's labels
cannot carry a Context, an Options list, or a drafted table, so what it saves in
typing it takes out of the user's ability to answer.

## Steps

**1. Understand the idea.** Let the user talk; reflect back what you heard in
plain words. Read the codebase in-context (Read/Grep/Glob) when it answers a
question — never ask what the code can answer.

When the idea traces to a ticket, read the ticket first. Its
`## Decisions` lines are outcomes the user already settled — never re-ask
them, and do not copy them into this skill's exit file: the `plan` skill harvests
the ticket itself, and a copy here would put the same row in the record
twice. Its `## Open questions` are this conversation's agenda. Its
acceptance criteria are floors, never ceilings: a criterion naming one case
does not decide that other cases are out of scope. A "no" the user settles
here is a decision row like any other, and a rejected idea never becomes a
new ticket.

**2. Scope check.** Judge out loud: is this one buildable idea, one idea too
big for a single pass, or several independent ideas? Several → say so, agree
which one to shape now, and note the rest for later.

**3. Approaches.** Present 2–3 genuinely different ways to build it, in the
Question format — what each wins, what each costs, and which one you recommend
and why. Skip only when the user already arrived with a chosen approach, and
say so in one line.

**4. Converge.** State the design back in plain words — what gets built, what
it touches, what is explicitly out — and iterate until the user confirms it
matches what they meant.

**5. Exit.** Ask which way to leave.

Both exits write the ticket's planning status, so resolve the plugin root
first: it is two directories above this loaded `SKILL.md`'s absolute path. In
Claude Code, `${CLAUDE_PLUGIN_ROOT}` may provide the same path; do not assume
that variable exists in Codex skill shell calls. Use the resolved absolute path
wherever `<plugin-root>` appears below, and confirm `<plugin-root>/dist/cli.mjs`
exists before running anything. When the idea traces to no ticket, neither exit
writes anything — the ordinary case for a brainstorm that runs before its ticket
exists. A nonzero exit from either command below is a stop: report the exact
failure and do not claim the brainstorm finished.

- **"Just build it"** → write nothing — no folder, no file, no name. The
  converged design in the conversation is the deliverable; the user takes it
  from here.

  When the idea traces to a ticket, this exit still owes the tracker two
  things, in this order.

  First, **print the exact `## Decisions` lines the conversation settled**,
  ready to paste onto the ticket, and say that they belong on the ticket
  because the next command claims it as ready to build. This exit writes no
  file, so the ticket body is the only record of what was agreed — and this
  skill cannot write it: its tools carry no tracker access. Do not try. On Jira
  the API is reachable over `Bash`; on Linear it is not, and an instruction that
  works on one tracker and silently fails on the other is worse than one that is
  honestly a human step on both.

  Then run the command regardless — a printed obligation the human has not yet
  acted on is not a reason to leave the tracker saying the brainstorm never
  happened:

  ```sh
  node "<plugin-root>/dist/cli.mjs" ticket-state --ref <ticket> --planning-status planning-complete --tracker-status ready
  ```

  The status is `planning-complete`, not `planning-not-needed`: the ticket did
  require a brainstorm, and one just ran. `planning-not-needed` says a ticket
  never required one.
- **"Plan it"** → derive a kebab `<name>` from the idea (offer it for
  override). A brainstorm usually runs before a ticket exists, so the folder
  carries a bare slug; when a ticket already exists for the idea, use its
  canonical name instead — the plan folder is named exactly like the ticket's
  branch. When the ticket is filed later the folder is renamed to match, which
  the ticket-workflow skill's `## Plan folder` section spells out. Before
  writing anything, show the settled decisions back to the user as a small
  table — question, choice, one-line why, and whether it is an assumption — and
  get approval: these rows make the `plan` skill skip questions, so a row that
  overstates the agreement is expensive. Then write the notes to
  `.lightsout/plans/<name>/notes.md`, plus
  `.lightsout/plans/<name>/brainstorm-decisions.json` in this exact shape:

  ```json
  {
    "planName": "<name>",
    "decisions": [
      { "source": "Brainstorm", "question": "<q>", "options": "<A / B>",
        "choice": "<chosen>", "rationale": "<one line>", "assumption": false }
    ]
  }
  ```

  - `source` is exactly `"Brainstorm"` on every row — the engine rejects the
    file otherwise.
  - Every project-wide rule the user stated gets its own row whose `question`
    begins exactly `Global constraint:` — that prefix is what carries it into
    the plan's constraints section.
  - A choice the user never explicitly confirmed is written with
    `"assumption": true`.
  - One row per decision that establishes or changes a design choice or an
    edge-case handling — not per exchange.

  Then hand off with the exact next command:

  ```
  Next: run the `plan` skill with .lightsout/plans/<name>/notes.md
  ```

  If either file already exists at that name (a previous brainstorm), say so
  and agree a different name — never overwrite silently.

  Then, when the idea traces to a ticket, move its planning status:

  ```sh
  node "<plugin-root>/dist/cli.mjs" ticket-state --ref <ticket> --planning-status planning-needs-plan
  ```

  This exit moves the planning status only, and passes no `--tracker-status`.
  The ticket stays where it is, because interactive planning is Backlog work and
  no config key names a Backlog role to move it to.

  **The command writes the label; it does not attach the evidence.** The
  ticket-workflow rule is that `notes.md` goes onto the ticket whenever
  `planning-needs-plan` is set — that label is the one claim in the model that
  owes proof, and `.lightsout` is gitignored, so an unattached `notes.md` exists
  on exactly one laptop. No engine command can do it at this moment: `lightsout
  plan publish` refuses when the folder holds no plan deliverable, and at this
  exit only `notes.md` and `brainstorm-decisions.json` are on disk. This skill's
  tools cannot do it either.

  So print the obligation rather than claiming it discharged: after the command
  succeeds, print one line naming the absolute path of `notes.md` and saying it
  must be attached to the ticket now. The rule is in the ticket-workflow skill's
  `### Recording it` section.

## Notes file content

A checklist, not a template this skill enforces:

- the idea in the user's words
- the scope call
- the chosen approach and the rejected alternatives with the one-line why
- the converged design in plain words
- any project-wide constraints the user stated (so the `plan` skill can carry them into
  its Global Constraints collection)
