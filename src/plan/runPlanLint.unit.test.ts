import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { StructuralCheck } from '@/contracts';
import { runPlanLint } from '@/plan';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { expectStatus } from '@tests/helpers/expectStatus';

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

	expectStatus(result, 'complete');
	expect('findings' in result).toBeTruthy();
	// clean plan should have no findings, got: ${JSON.stringify(result.findings)}
	expect(result.findings).toStrictEqual([]);
	// the resolved deliverable path comes back
	expect(result.planPaths).toStrictEqual([join(plansDir, 'clean.md')]);
});

test('plan lint: a planted TBD comes back as a NoPlaceholders finding', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'dirty.md', body: cleanPlan().replace('A new module exporting', 'TBD — a new module exporting') });

	const result = await runPlanLint({ cwd, name: 'dirty', plansDir });

	expectStatus(result, 'complete');
	expect('findings' in result).toBeTruthy();
	// the TBD is flagged, got: ${JSON.stringify(result.findings)}
	expect(result.findings.some((finding) => finding.check === StructuralCheck.NoPlaceholders)).toBeTruthy();
});

test('plan lint: the progress line reports the finding count and how many files were scanned', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'progress.md', body: cleanPlan().replace('A new module exporting', 'TBD — a new module exporting') });
	const messages: string[] = [];

	const result = await runPlanLint({ cwd, name: 'progress', plansDir, onProgress: (message) => messages.push(message) });

	expectStatus(result, 'complete');
	// one progress line per lint pass
	expect(messages.length).toBe(1);
	expect(messages[0]).toMatch(/progress.*1 structural finding\(s\).*1 file\(s\)/);
});

test('plan lint: no deliverable on disk returns failed', async () => {
	const cwd = setupConsumerRepo();

	const result = await runPlanLint({ cwd, name: 'ghost', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'failed');
	// the resolve error propagates
	expect('error' in result && /no plan found for 'ghost'/.test(result.error)).toBeTruthy();
});

/** A structurally clean overview file — the overview variant's own required section set. */
const cleanOverview = () => `# Phased Plan — Overview

## Global Constraints

- None

## Phases

| # | File | Scope |
|---|------|-------|
| 1 | \`phase1-core.md\` | the core |
| 2 | \`phase2-extra.md\` | the rest |

## Cross-Phase Dependencies

- Phase 2 follows phase 1.
`;

/** Write a phased deliverable at <plansDir>/<name>/ and return the plans dir. */
const writePhasedPlan = ({ cwd, name, files }: { cwd: string; name: string; files: Record<string, string> }) => {
	const plansDir = join(cwd, '.claude', 'plans');

	mkdirSync(join(plansDir, name), { recursive: true });

	for (const [fileName, body] of Object.entries(files)) {
		writeFileSync(join(plansDir, name, fileName), body);
	}

	return plansDir;
};

test('plan lint: a phased deliverable lints the overview first, then each phase, ignoring non-markdown', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePhasedPlan({
		cwd,
		name: 'phased',
		files: {
			'overview.md': cleanOverview(),
			'phase1-core.md': cleanPlan(),
			'phase2-extra.md': cleanPlan(),
			'notes.txt': 'scratch notes, not a plan',
		},
	});

	const result = await runPlanLint({ cwd, name: 'phased', plansDir });

	expectStatus(result, 'complete');
	expect('planPaths' in result).toBeTruthy();
	// the overview fronts the sorted phase files and notes.txt is not a plan
	expect(result.planPaths).toStrictEqual([join(plansDir, 'phased', 'overview.md'), join(plansDir, 'phased', 'phase1-core.md'), join(plansDir, 'phased', 'phase2-extra.md')]);
	// a clean phased deliverable has no findings, got:
	// ${JSON.stringify(result.findings)}
	expect(result.findings).toStrictEqual([]);
});

test('plan lint: the target repo config reaches the structural lint', async () => {
	const cwd = setupConsumerRepo({ config: { packagesDir: 'modules' } });
	const plansDir = writePlan({ cwd, name: 'configured.md', body: cleanPlan().replace('### `src/index.js`', '### `modules/loose.ts`') });

	const result = await runPlanLint({ cwd, name: 'configured', plansDir });

	expectStatus(result, 'complete');
	expect('findings' in result).toBeTruthy();
	// the configured packagesDir drove the check, got:
	// ${JSON.stringify(result.findings)}
	expect(result.findings.some(
		(finding) => finding.check === StructuralCheck.PackagesIdentifiable && finding.issue.includes('directly under modules/'),
	)).toBeTruthy();
});

test('plan lint: an unreadable config leaves the lint running on defaults', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'no-config.md', body: cleanPlan() });

	writeFileSync(join(cwd, 'lightsout.config.json'), '{ not json');

	const result = await runPlanLint({ cwd, name: 'no-config', plansDir });

	expectStatus(result, 'complete');
	expect('findings' in result).toBeTruthy();
	// a broken config is non-fatal here, got: ${JSON.stringify(result.findings)}
	expect(result.findings).toStrictEqual([]);
});
