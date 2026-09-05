---
name: brainstorm
description: Shape a vague idea into a buildable direction through dialogue — checks whether it is one idea or several, offers 2–3 competing approaches with trade-offs and a recommendation, and converges on a design stated in plain words. Use when the user has a rough idea, wants to think through a feature before planning it, or asks to brainstorm. It decides its own outcome — ready to implement, or ready to auto-plan — and always writes the design write-up and the settled decisions, publishing both to the ticket.
allowed-tools: Bash, Read, Write, Grep, Glob, Task
---

# lightsout: brainstorm

**This skill is an interactive conductor, not the engine.** It holds zero
deterministic decisions — no gates, retries, caps, state, or contract parsing.
It runs two engine subcommands, `brainstorm publish` and `ticket-state`, and
only when the idea traces to a ticket; it still holds no deterministic decision
of its own, and it never reads back what it writes. Triggering is gentle: the
description above is the only trigger — no hook, no forced invocation. Writing
the settled-decisions file below changes nothing about this standing — the skill
never reads the file back; the engine validates it at draft time.

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

## Plugin root

Resolve the plugin root once from this loaded skill's absolute path: it is two
directories above this `SKILL.md`. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` may
provide the same path; do not assume that variable exists in Codex skill shell
calls. Use the resolved absolute path wherever `<plugin-root>` appears below,
and confirm `<plugin-root>/dist/cli.mjs` exists before running anything.

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

**5. Probe for what is still open.** The session that had the conversation is
the worst judge of whether it covered everything — believing it did is the
exact failure this step exists to catch. So hand the work to a reader who was
not there.

Write the converged design out in full, plus the ticket when there is one, and
spawn a subagent with no memory of this conversation. Its brief: read that
statement and the ticket, read nothing else of the conversation, and answer
with the questions a builder would still have to guess at.

Test each returned question against the escalation bar defined in the
`auto-plan` skill's `## The escalation bar` section, at
`<plugin-root>/skills/auto-plan/SKILL.md`. Read it there — that section is the
one definition of the bar and this skill never restates it. Ask what clears the
bar in the Question format, one at a time, fold each answer into the design,
then probe once more. **At most two rounds**, then stop: a loop with a human in
it spends their attention rather than the machine's.

**6. Judge the outcome.** The skill decides this itself; never ask the user
which exit to take. The brainstorm holds the context needed to judge, so asking
would hand the work back for no gain.

**Ready to implement** requires **all five** of:

- every file that changes is named, along with what changes in each;
- nothing is left open;
- one package is touched;
- the change adds nothing a user can see — no new command, flag, config key or
  output;
- the test that proves it can be named in one sentence.

Anything else is **ready to auto-plan**. Say which outcome you chose and why, in
one line.

**7. Write, publish, label.** Both outcomes write both files. There is no exit
that writes nothing.

Derive a kebab `<name>` from the idea and offer it for override. A brainstorm
usually runs before a ticket exists, so the folder carries a bare slug; when a
ticket already exists for the idea, use its canonical name instead — the plan
folder is named exactly like the ticket's branch. When the ticket is filed later
the folder is renamed to match, which the ticket-workflow skill's `## Plan
folder` section spells out.

Before writing anything, show the settled decisions back to the user as a small
table — question, choice, one-line why, and whether it is an assumption — and
get approval: these rows make the planning skills skip questions, so a row that
overstates the agreement is expensive.

Then write the notes to `.lightsout/plans/<name>/brainstorm-notes.md`, plus
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

**If either file is already at that name**, a previous brainstorm wrote it, and
what to do splits by case:

- **Ticket-backed:** the canonical name is not negotiable — `brainstorm publish`
  reads the ticket id off the folder name, so a folder renamed to dodge an
  existing file can never be published. Say what the existing files hold and ask
  before replacing them; on a yes, overwrite in place and keep the name. Never
  rename.
- **No ticket:** say so and agree a different name. A bare slug is only a local
  handle and nothing resolves a ticket from it.

**When the idea traces to a ticket**, run these in order. A nonzero exit from
either is a stop: report the exact failure and do not claim the brainstorm
finished.

```sh
node "<plugin-root>/dist/cli.mjs" brainstorm publish --name <name>
```

Then, for **ready to implement**:

```sh
node "<plugin-root>/dist/cli.mjs" ticket-state --ref <ticket> --planning-status planning-complete --tracker-status ready
```

or, for **ready to auto-plan**:

```sh
node "<plugin-root>/dist/cli.mjs" ticket-state --ref <ticket> --planning-status planning-ready-auto-plan
```

Ready to auto-plan passes no `--tracker-status`: a ticket awaiting a plan is not
ready to implement, and Backlog is already queue-eligible.

**When the idea traces to no ticket**, neither command runs and the files stay
on disk. That is the ordinary case for a brainstorm that runs before its ticket
exists.

**8. Close.** With a ticket:

- **Ready to implement:** name the ticket, say it is now Ready to implement, and
  say the queue's next drain builds it from the ticket body. Print no
  `lightsout implement` command — that command takes `--plan <path>` and the
  engine refuses a folder holding neither `plan.md` nor `overview.md`, which is
  exactly what this outcome writes, so any command printed here could not run.
- **Ready to auto-plan:** print the exact next command —
  ``Next: run the `auto-plan` skill on <ticket>`` — and add one line saying that
  a person who would rather plan it themselves sets `planning-needs-plan` by
  hand instead.

With no ticket, both outcomes point at the folder rather than at a tracker,
because nothing was published. Both lines carry the same second sentence: file
the ticket, rename the folder to the ticket's branch name — the ticket-workflow
skill's `## Plan folder` section says what else a rename has to update — and
then run `brainstorm publish`, because until that happens the record exists on
one laptop.

- **Ready to auto-plan:** ``Next: run the `auto-plan` skill with
  .lightsout/plans/<name>/brainstorm-notes.md``
- **Ready to implement:** name `.lightsout/plans/<name>/` and say the two files
  plus the converged design are the whole record, so the work can be built
  straight from them. Print no command here either, for the reason above.

## Notes file content

A checklist, not a template this skill enforces:

- the idea in the user's words
- the scope call
- the chosen approach and the rejected alternatives with the one-line why
- the converged design in plain words
- any project-wide constraints the user stated (so the planning skills can carry
  them into their Global Constraints collection)
- the outcome this skill chose — ready to implement, or ready to auto-plan — and
  the one-line why
