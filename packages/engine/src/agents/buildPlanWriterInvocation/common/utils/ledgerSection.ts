/**
 * The writer's brief on the acceptance-test ledger: what a contract plan
 * carries, and what it stops carrying. The behaviour a plan used to narrate is
 * what a row states, so the two are alternatives rather than additions.
 */
export const ledgerSection = (): string =>
	`## Acceptance-test ledger

This repository writes plans as CONTRACTS. A contract plan carries what a test
cannot detect — the file map, the full exported signatures of every created
file, the file each new file mirrors, and the decisions — plus a ledger of the
tests that state its acceptance criteria. It does NOT narrate inner
implementation: a behaviour expectation is a ledger row, never a paragraph.

Every implementable file you write carries a table of this shape, one row per
acceptance criterion — the criterion in one line, the test file in a backticked
span, the exact test name a writer will use, and the gate key from the
repository's gates that runs it. A blank gate cell means the test gate.

| Criterion | Test file | Test name | Gate |
|-----------|-----------|-----------|------|
| <one-line acceptance criterion> | \`path/to/file.unit.test.ts\` | <exact test name> | test |

- A row may name a test file that already exists — adding a case to one is
  ordinary work. It may NOT name a test that file already holds: a test written
  for older behaviour must never be locked in as the verifier of a new
  criterion.
- A file with no testable behaviour — a document, a config file, a barrel — is
  listed under \`## Prose Files\` instead, one \`-\` bullet each: the path in a
  backticked span, then an em dash and why no test states its behaviour. A
  bullet naming a path with no reason is a blocking finding.
- Every source file the plan creates or modifies is either reached by a row or
  named under \`## Prose Files\`. Both sections go on every implementable file
  and never on the overview.`;
