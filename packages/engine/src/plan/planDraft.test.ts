import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PlanDraftReport } from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { runPlanDraft } from '../index';
import { setupConsumerRepo } from '../../tests/helpers/setupConsumerRepo';

/** Seed the plan workspace with the facts + decisions `plan draft` reads. */
const seedWorkspace = ({ cwd, name }: { cwd: string; name: string }) => {
	const dir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'facts.json'),
		JSON.stringify({
			request: 'do a thing',
			areas: [],
			verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [], createPathsThatExist: [] },
			verifiedAt: '2026-01-01T00:00:00.000Z',
		}),
	);
	writeFileSync(join(dir, 'decisions.json'), JSON.stringify({ planName: name, decisions: [] }));
};

/** A structurally clean single plan whose paths resolve against setupConsumerRepo. */
const cleanPlan = () => `# Drafted Plan

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

- \`newThing\` — searched newThing, found none (new).

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

/** Same skeleton but with a planted placeholder, so the structural lint flags it. */
const dirtyPlan = () => cleanPlan().replace('A new module exporting', 'TBD — a new module exporting');

/** The absolute path the draft prompt tells the writer to write to. */
const outputPathFrom = (prompt: string) => /- (\S+\.md)/.exec(prompt)?.[1];

/**
 * A plan-writer stub keyed off the draft marker. `bodies` is the sequence of
 * plan contents to write across successive attempts (the last is reused if the
 * loop runs longer). Writes the file to the path named in the prompt and returns
 * a valid PlanDraftReport, exactly like the real agent.
 */
const draftDriver = ({ bodies, onCall }: { bodies: string[]; onCall?: () => void }): Driver => {
	let call = 0;

	return {
		name: 'stub',
		invoke: async ({ prompt }) => {
			assert.ok(prompt.includes('# Draft input'), 'plan-writer invocation marker present');
			onCall?.();

			const path = outputPathFrom(prompt);

			assert.ok(path, 'output path parsed from the draft prompt');

			const body = bodies[Math.min(call, bodies.length - 1)];

			call += 1;
			writeFileSync(path, body);

			return {
				text: JSON.stringify({
					status: 'drafted',
					filesWritten: [{ path, variant: 'single', scope: 'single' }],
					decisionsApplied: 0,
					assumptions: [],
					discrepancies: [],
				}),
				exitCode: 0,
			};
		},
	};
};

test('plan draft: writes plan.md and returns a valid PlanDraftReport', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'draft-me' });

	const plansDir = join(cwd, '.claude', 'plans');
	const result = await runPlanDraft({ cwd, driver: draftDriver({ bodies: [cleanPlan()] }), name: 'draft-me', plansDir });

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.ok(existsSync(join(plansDir, 'draft-me.md')), 'plan.md written at <plansDir>/<name>.md');
	assert.ok('report' in result && result.report);
	assert.doesNotThrow(() => PlanDraftReport.parse(result.report));
});

test('plan draft: a TBD then a clean draft proves the structural re-draft loop converges', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'converge' });

	let calls = 0;
	const driver = draftDriver({ bodies: [dirtyPlan(), cleanPlan()], onCall: () => (calls += 1) });
	const result = await runPlanDraft({ cwd, driver, name: 'converge', plansDir: join(cwd, '.claude', 'plans') });

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.equal(calls, 2, 'the dirty first draft forced exactly one re-draft');
});

test('plan draft: a report.status of error returns facts-error and writes no plan', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'bad-facts' });

	const driver: Driver = {
		name: 'stub',
		invoke: async () => ({
			text: JSON.stringify({
				status: 'error',
				filesWritten: [],
				decisionsApplied: 0,
				assumptions: [],
				discrepancies: ['facts reference src/ghost.ts — does not exist'],
			}),
			exitCode: 0,
		}),
	};
	const result = await runPlanDraft({ cwd, driver, name: 'bad-facts', plansDir: join(cwd, '.claude', 'plans') });

	assert.equal(result.status, 'facts-error');
	assert.ok('discrepancies' in result && result.discrepancies.length === 1);
	assert.ok(!existsSync(join(cwd, '.claude', 'plans', 'bad-facts.md')), 'no plan written on facts-error');
});

test('plan draft: a missing decisions.json makes readDecisions throw', async () => {
	const cwd = setupConsumerRepo();
	const dir = join(cwd, '.lightsout', 'plans', 'no-decisions');

	mkdirSync(dir, { recursive: true });
	// facts.json present, decisions.json absent.
	writeFileSync(
		join(dir, 'facts.json'),
		JSON.stringify({
			request: 'x',
			areas: [],
			verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [], createPathsThatExist: [] },
			verifiedAt: '2026-01-01T00:00:00.000Z',
		}),
	);

	await assert.rejects(
		runPlanDraft({ cwd, driver: draftDriver({ bodies: [cleanPlan()] }), name: 'no-decisions', plansDir: join(cwd, '.claude', 'plans') }),
		/no decisions found/,
	);
});
