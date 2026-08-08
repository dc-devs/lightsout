---
name: brainstorm
description: Shape a vague idea into a buildable direction through dialogue — checks whether it is one idea or several, offers 2–3 competing approaches with trade-offs and a recommendation, and converges on a design stated in plain words. Use when the user has a rough idea, wants to think through a feature before planning it, or asks to brainstorm. Exits either to "just build it" (nothing written) or to a rough-notes file handed to `/plan`.
allowed-tools: Read, Write, Grep, Glob
---

# lightsout: brainstorm

**This skill is an interactive conductor, not the engine.** It holds zero
deterministic decisions — no gates, retries, caps, state, or contract parsing.
It runs no engine subcommands and needs no bundle. Triggering is gentle: the
description above is the only trigger — no hook, no forced invocation.
Writing the settled-decisions file below changes nothing about this standing —
the skill still runs no engine subcommand, needs no bundle, and never reads
the file back; the engine validates it at draft time.

## Question format

Every question this skill puts to the user uses this labeled four-part
shape, in this order:

**Context:** what the question is about and why it matters, in everyday
words. Write for someone who has not read the plan or the code — never
assume they know the plan's internals. State the problem the question
decides — in everyday words — before naming any options.

**Trade-offs:** what each answer wins and what it costs, plainly. When an
option carries risk, say what goes wrong if it fails and what catches it.

**Question:** the question itself, one sentence.

**Recommendation:** the answer you recommend and the one-line why, so a
one-word reply ("yes", "the second one") resolves it.

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

**Option labels are everyday words.** Name each option by what it does
("copy the file each run", "keep the first copy") — never invented
shorthand, codenames, or bare letter labels the reader must decode.

**Keep each part short.** Aim for 1–3 plain sentences per label. When a
question outgrows that, treat it as a sign it is really two questions —
split it.

**One question at a time is the default here** — brainstorm conversations
are exploratory, not batched.

**The format applies regardless of medium.** When asking through an
option-picker tool, the Context, Trade-offs, and Recommendation go in the
question body — never squeezed into option labels.

## Steps

**1. Understand the idea.** Let the user talk; reflect back what you heard in
plain words. Read the codebase in-context (Read/Grep/Glob) when it answers a
question — never ask what the code can answer.

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

**5. Exit.** Ask which way to leave:

- **"Just build it"** → write nothing — no folder, no file, no name. The
  converged design in the conversation is the deliverable; the user takes it
  from here.
- **"Plan it"** → derive a kebab `<name>` from the idea (offer it for
  override). Before writing anything, show the settled decisions back to the
  user as a small table — question, choice, one-line why, and whether it is an
  assumption — and get approval: these rows make `/plan` skip questions, so a
  row that overstates the agreement is expensive. Then write the notes to
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
  Next: /plan .lightsout/plans/<name>/notes.md
  ```

  If either file already exists at that name (a previous brainstorm), say so
  and agree a different name — never overwrite silently.

## Notes file content

A checklist, not a template this skill enforces:

- the idea in the user's words
- the scope call
- the chosen approach and the rejected alternatives with the one-line why
- the converged design in plain words
- any project-wide constraints the user stated (so `/plan` can carry them into
  its Global Constraints collection)
