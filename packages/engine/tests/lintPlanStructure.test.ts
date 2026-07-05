import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { StructuralCheck } from '@lightsout/contracts';
import { lintPlanStructure } from '../src/index';
import { setupConsumerRepo } from './helpers/setupConsumerRepo';

/** Write a plan file into the repo and return its absolute path. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.claude', 'plans');

	mkdirSync(dir, { recursive: true });

	const path = join(dir, name);

	writeFileSync(path, body);

	return path;
};

/** A structurally clean single/phase plan whose paths resolve against setupConsumerRepo. */
const cleanPlan = () => `# Clean Plan

## Context

A tiny clean plan for the structural lint.

## Prerequisites

- None

## Files to Create

### \`src/new-thing.ts\`

A new module exporting \`newThing\`.

## Files to Modify

### \`src/index.js\`

Re-export \`newThing\`.

## Patterns to Mirror

- \`src/index.js\` — mirror its single-export shape.

## Prior Art

- \`newThing\` — searched newThing/new-thing, found none (new).

## Scope Boundaries

**Do:**
- Add \`newThing\`.

**Do NOT:**
- Touch anything else.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None — standalone plan.
`;

test('lintPlanStructure: a missing Files to Modify path is flagged', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'missing-modify.md',
		body: `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/does-not-exist.ts\`

Change something.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.PathExists && finding.issue.includes('src/does-not-exist.ts')),
		'the missing modify path is flagged',
	);
});

test('lintPlanStructure: a Files to Create path that already exists is flagged', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'create-exists.md',
		body: `# Plan

## Prerequisites

- None

## Files to Create

### \`src/index.js\`

But this already exists.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.PathExists && finding.issue.includes('already exists')),
		'the create path that exists is flagged',
	);
});

test('lintPlanStructure: a TBD placeholder is flagged', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'placeholder.md',
		body: `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/index.js\`

Do TBD here.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(findings.some((finding) => finding.check === StructuralCheck.NoPlaceholders), 'the TBD is flagged');
});

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

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.SectionsPresent && finding.issue.includes('What Next Plan Expects')),
		'the missing section is flagged',
	);
});

test('lintPlanStructure: a 60-file plan trips ScopeWithinGuardrail', async () => {
	const cwd = setupConsumerRepo();
	const creates = Array.from({ length: 60 }, (_, index) => `### \`src/gen${index}.ts\`\n\nGenerated module ${index}.\n`).join('\n');
	const path = writePlan({
		cwd,
		name: 'too-big.md',
		body: `# Plan

## Prerequisites

- None

## Files to Create

${creates}

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(findings.some((finding) => finding.check === StructuralCheck.ScopeWithinGuardrail), 'the oversized plan is flagged');
});

test('lintPlanStructure: a clean plan returns no findings', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'clean.md', body: cleanPlan() });

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.deepEqual(findings, [], `clean plan should have no findings, got: ${JSON.stringify(findings)}`);
});
