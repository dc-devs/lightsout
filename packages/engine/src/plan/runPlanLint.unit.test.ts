import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { StructuralCheck } from '@lightsout/contracts';
import { runPlanLint } from './index';
import { setupConsumerRepo } from '../../tests/helpers/setupConsumerRepo';

/** Write a plan deliverable into the repo's plans dir and return that dir. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.claude', 'plans');

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), body);

	return dir;
};

/** A structurally clean single plan whose paths resolve against setupConsumerRepo. */
const cleanPlan = () => `# Clean Plan

## Context

A tiny clean plan for the structural lint.

## Global Constraints

- None

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

test('plan lint: a clean plan returns complete with no findings and names the plan file', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'clean.md', body: cleanPlan() });

	const result = await runPlanLint({ cwd, name: 'clean', plansDir });

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.ok('findings' in result);
	assert.deepEqual(result.findings, [], `clean plan should have no findings, got: ${JSON.stringify(result.findings)}`);
	assert.deepEqual(result.planPaths, [join(plansDir, 'clean.md')], 'the resolved deliverable path comes back');
});

test('plan lint: a planted TBD comes back as a NoPlaceholders finding', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'dirty.md', body: cleanPlan().replace('A new module exporting', 'TBD — a new module exporting') });

	const result = await runPlanLint({ cwd, name: 'dirty', plansDir });

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.ok('findings' in result);
	assert.ok(
		result.findings.some((finding) => finding.check === StructuralCheck.NoPlaceholders),
		`the TBD is flagged, got: ${JSON.stringify(result.findings)}`,
	);
});

test('plan lint: the progress line reports the finding count and how many files were scanned', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'progress.md', body: cleanPlan().replace('A new module exporting', 'TBD — a new module exporting') });
	const messages: string[] = [];

	const result = await runPlanLint({ cwd, name: 'progress', plansDir, onProgress: (message) => messages.push(message) });

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.equal(messages.length, 1, 'one progress line per lint pass');
	assert.match(messages[0], /progress.*1 structural finding\(s\).*1 file\(s\)/);
});

test('plan lint: no deliverable on disk returns failed', async () => {
	const cwd = setupConsumerRepo();

	const result = await runPlanLint({ cwd, name: 'ghost', plansDir: join(cwd, '.claude', 'plans') });

	assert.equal(result.status, 'failed');
	assert.ok('error' in result && /no plan found for 'ghost'/.test(result.error), 'the resolve error propagates');
});
