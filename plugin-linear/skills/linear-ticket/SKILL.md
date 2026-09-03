---
name: linear-ticket
description: Linear's own mechanics for the lightsout ticket workflow — planning-status labels, statuses, attachments, branch linking and pull-request magic words. Use alongside the ticket-workflow skill when filing, shaping, or closing a Linear ticket for this team.
---

# Linear mechanics

Everything about what a ticket says, how it is shaped, how a branch and a
pull request are named, and how it is closed lives in the `ticket-workflow`
skill. Read that first. This skill adds only what is Linear's, and restates
none of it.

## Planning status labels

The five planning statuses sit in a Linear label group called `Planning
Status`, so a ticket carries exactly one. Each name repeats the `planning-`
prefix anyway, and that redundancy is deliberate: Linear's issue sidebar shows
the bare label without its group, so a label named `needs-brainstorm` alone
would read as an instruction to go and brainstorm — which is wrong the moment
the brainstorm is done and the ticket is waiting to be built.
`planning-needs-brainstorm` reads as a classification wherever you meet it.

The group's exclusivity is what makes exactly-one a tracker guarantee rather
than a convention, which is why the engine writes the label as a
group-exclusive set rather than an add.

**The label is the record.** It is a real field on the ticket: filterable, and
it overwrites rather than accumulating. Do not restate it in a comment, at
filing or at close. Each of the five carries its own description in Linear,
and they are defined in the ticket-workflow skill —
`planning-needs-brainstorm` already says why it is
`planning-needs-brainstorm`, and a sentence per ticket repeating that is
ceremony that rots. Linear keeps the revision history for anyone who wants the
superseded value.

## Statuses

The LightsOut team's Linear workflow states:

```
Backlog → Ready to implement → In Progress → Done
```

These four are the defaults `queue.eligible-statuses`, `queue.ready-status`,
`queue.in-progress-status` and `queue.done-status` resolve to, and the names the
ticket-workflow skill's transition table refers to.

## Branch linking

The ticket id is `LO-<number>` and a branch is named `lo-<number>-<slug>`,
matching the `ship.ticket-pattern` this repository configures. Linear finds
the ticket id anywhere in the branch name and links the branch to the issue.
Its copy-branch-name button prefixes your username; drop that, the id is the
only part that matters. The plan folder for `LO-<number>` carries that same
`lo-<number>-<slug>` name.

## Pull request body

The body is the one line `Closes LO-<number>`, which is this repository's
configured `ship.pr-body`. That line is what closes the ticket loop from the
GitHub side, and Linear links the pull request through the branch name.

## Attaching in Linear

Which files to attach is the ticket-workflow skill's rule and is not repeated
here. Its publish command handles the finished plan. When that workflow calls
for a manual attachment before a finished plan exists, attach the file as a
Linear issue attachment. Never put a plan in a Linear Document — a document
invites editing, and then two copies disagree about what was decided.
