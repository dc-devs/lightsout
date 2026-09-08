import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { StructuralCheck } from '#src/contracts/index.ts';
import { lintPlanStructure } from '#src/plan/lint/lintPlanStructure.ts';
import { emptyDecisionsRecord } from '#tests/helpers/emptyDecisionsRecord.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// The required heading set every repository's plans carry, per variant — the
// sibling files cover the two headings a repository's own config adds on top:
// `## Documentation` from a declared docs block, `## Acceptance Tests` from
// `plan.contract`.

/** Write a plan file into a plan's own folder and return its absolute path. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(dir, { recursive: true });

	const path = join(dir, name);

	writeFileSync(path, body);

	return path;
};

test('lintPlanStructure: a missing "What Next Plan Expects" section is flagged', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'no-next.md',
		body: `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/index.js\`

Change it.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord() });

	// the missing section is flagged
	expect(findings.some((finding) => finding.check === StructuralCheck.SectionsPresent && finding.issue.includes('What Next Plan Expects'))).toBeTruthy();
});

test('lintPlanStructure: a missing "Global Constraints" section is flagged on an implementable plan', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'no-constraints.md',
		body: `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/index.js\`

Change it.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord() });

	// the missing section is flagged
	expect(findings.some((finding) => finding.check === StructuralCheck.SectionsPresent && finding.issue.includes('Global Constraints'))).toBeTruthy();
});

test('lintPlanStructure: a missing "Global Constraints" section is flagged on an overview plan', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'overview-no-constraints.md',
		body: `# Plan — Overview

## Context

An overview without the constraints section.

## Phases

| # | File | Scope |
|---|------|-------|
| 1 | \`phase1-core.md\` | the core |

## Cross-Phase Dependencies

- None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord() });

	// the missing section is flagged on the overview variant
	expect(
		findings.some(
			(finding) => finding.check === StructuralCheck.SectionsPresent && finding.issue.includes('Global Constraints') && finding.issue.includes('overview'),
		),
	).toBeTruthy();
});
