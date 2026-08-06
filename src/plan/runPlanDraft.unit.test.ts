import { expect, test } from '@jest/globals';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effort, PlanDraftReport, PlanVariant, Permissions } from '@/contracts';
import type { Driver, DriverInvocation } from '@/drivers';
import { runPlanDraft } from '@/plan';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { getRejectionError } from '@tests/helpers/getRejectionError';
import { expectStatus } from '@tests/helpers/expectStatus';
import { expectDefined } from '@tests/helpers/expectDefined';

/** Seed the plan workspace with the facts + decisions `plan draft` reads. */
const seedWorkspace = ({ cwd, name, areas = [] }: { cwd: string; name: string; areas?: unknown[] }) => {
	const dir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'facts.json'),
		JSON.stringify({
			request: 'do a thing',
			areas,
			verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [], createPathsThatExist: [] },
			verifiedAt: '2026-01-01T00:00:00.000Z',
		}),
	);
	writeFileSync(join(dir, 'decisions.json'), JSON.stringify({ planName: name, decisions: [] }));
};

/** One explorer area whose facts touch the given modify and mirror paths. */
const areaTouching = ({ modify = [], mirror = [] }: { modify?: string[]; mirror?: string[] }) => ({
	area: 'core',
	filesToModify: modify.map((path) => ({ path, role: 'touched' })),
	patternsToMirror: mirror.map((path) => ({ path, takeaway: 'shape' })),
	namingConvention: 'camelCase',
});

/** `count` distinct repo-relative paths for the scope estimate. */
const paths = (count: number) => Array.from({ length: count }, (_, index) => `src/mod${index}.ts`);

/** A structurally clean single plan whose paths resolve against setupConsumerRepo. */
const cleanPlan = () => `# Drafted Plan

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

/** The clean skeleton with the given placeholder markers planted — one lint finding per distinct marker. */
const planWithMarkers = ({ markers }: { markers: string }) => cleanPlan().replace('A new module exporting', `${markers} — a new module exporting`);

/** Same skeleton but with a planted placeholder, so the structural lint flags it. */
const dirtyPlan = () => planWithMarkers({ markers: 'TBD' });

/** The absolute path the prompt names — the writer's output line and the repairer's plan-file bullet share the `- <path>` shape. */
const outputPathFrom = (prompt: string) => /- (\S+\.md)/.exec(prompt)?.[1];

/** The plan-writer's drafted report naming one written single-variant file. */
const draftedReport = ({ path }: { path: string }) =>
	JSON.stringify({
		status: 'drafted',
		filesWritten: [{ path, variant: 'single', scope: 'single' }],
		decisionsApplied: 0,
		assumptions: [],
		discrepancies: [],
	});

/**
 * A stub driver keyed off both invocation markers. A `# Draft input` prompt
 * authors the next body to the output path and returns a PlanDraftReport; a
 * `# Repair input` prompt rewrites the plan file listed in the prompt with the
 * next body and returns a PlanFixReport — unless `repair` overrides it (the
 * override does its own file edits and returns the report text). `bodies` is
 * the sequence of plan contents across successive calls (the last is reused if
 * the loop runs longer). `onInvoke` sees the whole invocation, `onCall` only
 * its prompt.
 */
const draftDriver = ({
	bodies,
	onCall,
	onInvoke,
	repair,
}: {
	bodies: string[];
	onCall?: (prompt: string) => void;
	onInvoke?: (invocation: DriverInvocation) => void;
	repair?: ({ path }: { path: string }) => string;
}): Driver => {
	let call = 0;

	return {
		name: 'stub',
		invoke: async (invocation) => {
			const { prompt } = invocation;

			onCall?.(prompt);
			onInvoke?.(invocation);

			const path = outputPathFrom(prompt);

			// plan path parsed from the prompt
			expectDefined(path);

			const body = bodies[Math.min(call, bodies.length - 1)];

			call += 1;

			if (prompt.includes('# Repair input')) {
				if (repair) {
					return { text: repair({ path }), exitCode: 0 };
				}

				writeFileSync(path, body);

				return {
					text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }),
					exitCode: 0,
				};
			}

			// plan-writer invocation marker present
			expect(prompt.includes('# Draft input')).toBeTruthy();
			writeFileSync(path, body);

			return { text: draftedReport({ path }), exitCode: 0 };
		},
	};
};

test('plan draft: writes plan.md and returns a valid PlanDraftReport', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'draft-me' });

	const plansDir = join(cwd, '.claude', 'plans');
	const result = await runPlanDraft({ cwd, driver: draftDriver({ bodies: [cleanPlan()] }), name: 'draft-me', plansDir });

	expectStatus(result, 'complete');
	// plan.md written at <plansDir>/<name>.md
	expect(existsSync(join(plansDir, 'draft-me.md'))).toBeTruthy();
	expect('report' in result && result.report).toBeTruthy();
	expect(() => PlanDraftReport.parse(result.report)).not.toThrow();
	expect('planPaths' in result).toBeTruthy();
	// the verified deliverable path comes back for the session to grade
	expect(result.planPaths).toStrictEqual([join(plansDir, 'draft-me.md')]);
});

test('plan draft: the writer is handed the self-lint command and granted exactly the prefix it starts with', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'self-lint' });

	const plansDir = join(cwd, '.claude', 'plans');
	const invocations: DriverInvocation[] = [];
	const driver = draftDriver({ bodies: [cleanPlan()], onInvoke: (invocation) => invocations.push(invocation) });
	const result = await runPlanDraft({ cwd, driver, name: 'self-lint', plansDir });

	expectStatus(result, 'complete');

	const [writer] = invocations;

	// the writer carries exactly one command grant
	expect(writer.allowedCommands?.length).toBe(1);

	const prefix = writer.allowedCommands?.[0] ?? '';

	// the grant is the plan-lint prefix, got: ${prefix}
	expect(prefix.endsWith(' plan lint')).toBeTruthy();
	// the granted prefix is unquoted — the harness matches it literally
	expect(prefix.includes('"')).toBeFalsy();
	// the embedded command extends the granted prefix verbatim, consumer paths
	// quoted, got: ${writer.prompt}
	expect(writer.prompt.includes(`${prefix} --name self-lint --plans "${plansDir}" --cwd "${cwd}"`)).toBeTruthy();
});

test('plan draft: the repair invocation gets no self-lint command and no command grant', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'repair-ungranted' });

	const invocations: DriverInvocation[] = [];
	const driver = draftDriver({ bodies: [dirtyPlan(), cleanPlan()], onInvoke: (invocation) => invocations.push(invocation) });
	const result = await runPlanDraft({ cwd, driver, name: 'repair-ungranted', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'complete');

	const repairInvocation = invocations.find((invocation) => invocation.prompt.includes('# Repair input'));

	// the dirty author forced a repair
	expectDefined(repairInvocation);
	// the grant is scoped to the writer alone
	expect(repairInvocation.allowedCommands).toBe(undefined);
	// the repairer is never told to self-lint
	expect(repairInvocation.prompt.includes('plan lint')).toBeFalsy();
});

test('plan draft: the repair invocation references the workspace facts/decisions by path, never inlined', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'repair-refs' });

	const invocations: DriverInvocation[] = [];
	const driver = draftDriver({ bodies: [dirtyPlan(), cleanPlan()], onInvoke: (invocation) => invocations.push(invocation) });
	const result = await runPlanDraft({ cwd, driver, name: 'repair-refs', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'complete');

	const repairInvocation = invocations.find((invocation) => invocation.prompt.includes('# Repair input'));

	// the dirty author forced a repair
	expectDefined(repairInvocation);

	const workspaceDir = join(cwd, '.lightsout', 'plans', 'repair-refs');

	// the decisions reference is the workspace path
	expect(repairInvocation.prompt.includes(`- Decisions record: ${join(workspaceDir, 'decisions.json')}`)).toBeTruthy();
	// the facts reference is the workspace path
	expect(repairInvocation.prompt.includes(`- Verified facts: ${join(workspaceDir, 'facts.json')}`)).toBeTruthy();
	// the seeded facts content never rides the prompt
	expect(repairInvocation.prompt.includes('do a thing')).toBeFalsy();
	// no fenced JSON reference block survives in the prompt
	expect(repairInvocation.prompt.includes('```json')).toBeFalsy();
});

test('plan draft: the resolved effort and permissions ride the writer and every repair invocation', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'effort-threaded' });

	const invocations: DriverInvocation[] = [];
	const driver = draftDriver({ bodies: [dirtyPlan(), cleanPlan()], onInvoke: (invocation) => invocations.push(invocation) });
	const result = await runPlanDraft({
		cwd,
		driver,
		name: 'effort-threaded',
		plansDir: join(cwd, '.claude', 'plans'),
		effort: Effort.High,
		permissions: Permissions.FullAccess,
	});

	expectStatus(result, 'complete');
	// a repair must run at the same effort and capability level the writer got
	expect(invocations.map(({ prompt, effort, permissions }) => ({ role: prompt.includes('# Repair input') ? 'repair' : 'writer', effort, permissions }))).toStrictEqual([
		{ role: 'writer', effort: 'high', permissions: 'full-access' },
		{ role: 'repair', effort: 'high', permissions: 'full-access' },
	]);
});

test('plan draft: an unset effort and permissions reach the driver undefined — no default is invented here', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'no-effort' });

	const invocations: DriverInvocation[] = [];
	const driver = draftDriver({ bodies: [cleanPlan()], onInvoke: (invocation) => invocations.push(invocation) });
	const result = await runPlanDraft({ cwd, driver, name: 'no-effort', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'complete');
	// the caller resolves the level; this role never substitutes one of its own
	expect(invocations.map(({ effort, permissions }) => ({ effort, permissions }))).toStrictEqual([{ effort: undefined, permissions: undefined }]);
});

test('plan draft: a TBD author then a clean repair proves the repair loop converges without re-authoring', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'converge' });

	const prompts: string[] = [];
	const driver = draftDriver({ bodies: [dirtyPlan(), cleanPlan()], onCall: (prompt) => prompts.push(prompt) });
	const result = await runPlanDraft({ cwd, driver, name: 'converge', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'complete');
	// the dirty author forced exactly one repair
	expect(prompts.length).toBe(2);
	// attempt 1 authors
	expect(prompts[0].includes('# Draft input')).toBeTruthy();
	// the author prompt carries no corrective findings section
	expect(prompts[0].includes('Structural findings')).toBeFalsy();
	// attempt 2 is a repair, never a re-author
	expect(prompts[1].includes('# Repair input')).toBeTruthy();
});

test('plan draft: repairs that shrink but never clear the findings exhaust the budget and return structural-issues', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'exhaust' });

	let calls = 0;
	// 3 → 2 → 1 → 1 findings: every round is real progress, so the loop runs to
	// the cap instead of tripping the no-progress exit.
	const driver = draftDriver({
		bodies: [
			planWithMarkers({ markers: 'TBD TODO ???' }),
			planWithMarkers({ markers: 'TBD TODO' }),
			planWithMarkers({ markers: 'TBD' }),
			planWithMarkers({ markers: 'TBD' }),
		],
		onCall: () => (calls += 1),
	});
	const result = await runPlanDraft({ cwd, driver, name: 'exhaust', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'structural-issues');
	// 1 author + exactly 3 repairs
	expect(calls).toBe(4);
	expect('findings' in result && result.findings.length > 0).toBeTruthy();
	// the draft path survives intact for the session to fix
	expect('planPaths' in result && existsSync(result.planPaths[0])).toBeTruthy();
});

test('plan draft: a repair that leaves the finding set identical stops the loop instead of burning the budget', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'no-progress' });

	let calls = 0;
	const driver = draftDriver({ bodies: [dirtyPlan()], onCall: () => (calls += 1) });
	const result = await runPlanDraft({ cwd, driver, name: 'no-progress', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'structural-issues');
	// 1 author + 1 repair — the identical re-linted set breaks before a second
	// repair
	expect(calls).toBe(2);
	// the survivors return for the session to fix
	expect('findings' in result && result.findings.length > 0).toBeTruthy();
});

test('plan draft: a surviving finding that merely drifted lines is not progress', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'drift' });

	let calls = 0;
	// The repair prepends prose, shifting the TBD's line number while its
	// check + issue stay identical — location is deliberately out of the key.
	const driver = draftDriver({
		bodies: [dirtyPlan(), `Extra context prose that shifts every later line down.\n\n${dirtyPlan()}`],
		onCall: () => (calls += 1),
	});
	const result = await runPlanDraft({ cwd, driver, name: 'drift', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'structural-issues');
	// line drift alone never buys another repair
	expect(calls).toBe(2);
});

test('plan draft: a repairer error stops the loop after one repair', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'declined' });

	let calls = 0;
	const driver = draftDriver({
		bodies: [dirtyPlan()],
		onCall: () => (calls += 1),
		repair: () => JSON.stringify({ status: 'error', filesEdited: [], discrepancies: ['finding X unresolvable'] }),
	});
	const result = await runPlanDraft({ cwd, driver, name: 'declined', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'structural-issues');
	// no further repairs burned after the decline
	expect(calls).toBe(2);
});

test('plan draft: a declined repair still re-lints, so partial fixes leave only true survivors', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'partial' });

	// Two planted placeholders → two findings. The repair fixes TODO, declines TBD.
	const twoFindingsPlan = cleanPlan().replace('A new module exporting', 'TBD TODO — a new module exporting');
	const driver = draftDriver({
		bodies: [twoFindingsPlan],
		repair: ({ path }) => {
			writeFileSync(path, readFileSync(path, 'utf8').replace('TODO ', ''));

			return JSON.stringify({ status: 'error', filesEdited: [path], discrepancies: ["'TBD' unresolvable from the inputs"] });
		},
	});
	const result = await runPlanDraft({ cwd, driver, name: 'partial', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'structural-issues');
	expect('findings' in result).toBeTruthy();
	// the surviving set comes from the post-repair lint, not the stale pre-repair
	// list
	expect(result.findings.length).toBe(1);
	expect(result.findings[0].issue).toMatch(/TBD/);
});

test('plan draft: a declined repair whose edits cleaned the plan returns complete — the lint decides, not the report', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'declined-clean' });

	let calls = 0;
	const driver = draftDriver({
		bodies: [dirtyPlan()],
		onCall: () => (calls += 1),
		repair: ({ path }) => {
			writeFileSync(path, cleanPlan());

			return JSON.stringify({ status: 'error', filesEdited: [path], discrepancies: ['declared unresolvable, yet fixed'] });
		},
	});
	const result = await runPlanDraft({ cwd, driver, name: 'declined-clean', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'complete');
	// the decline still stops the loop after its re-lint
	expect(calls).toBe(2);
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

	expectStatus(result, 'facts-error');
	expect('discrepancies' in result && result.discrepancies.length === 1).toBeTruthy();
	// no plan written on facts-error
	expect(existsSync(join(cwd, '.claude', 'plans', 'bad-facts.md'))).toBeFalsy();
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

	await expect(runPlanDraft({ cwd, driver: draftDriver({ bodies: [cleanPlan()] }), name: 'no-decisions', plansDir: join(cwd, '.claude', 'plans') })).rejects.toThrow(/no decisions found/);
});

test('plan draft: a missing facts.json rejects pointing at plan verify-facts', async () => {
	const cwd = setupConsumerRepo();

	// No workspace seeded at all — readPlanFacts must throw before any invocation.
	await expect(runPlanDraft({ cwd, driver: draftDriver({ bodies: [cleanPlan()] }), name: 'no-facts', plansDir: join(cwd, '.claude', 'plans') })).rejects.toThrow(/no facts found[\s\S]*plan verify-facts --name no-facts/);
});

test('plan draft: a corrupt facts.json rejects rather than reading as empty facts', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'corrupt-facts' });
	writeFileSync(join(cwd, '.lightsout', 'plans', 'corrupt-facts', 'facts.json'), '{ not json');

	await expect(runPlanDraft({ cwd, driver: draftDriver({ bodies: [cleanPlan()] }), name: 'corrupt-facts', plansDir: join(cwd, '.claude', 'plans') })).rejects.toThrow(SyntaxError);
});

test('plan draft: a decisions.json that fails the contract rejects rather than drafting from it', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'bad-decisions' });
	writeFileSync(join(cwd, '.lightsout', 'plans', 'bad-decisions', 'decisions.json'), JSON.stringify({ planName: 7, decisions: [] }));

	const error = await getRejectionError({
		promise: runPlanDraft({ cwd, driver: draftDriver({ bodies: [cleanPlan()] }), name: 'bad-decisions', plansDir: join(cwd, '.claude', 'plans') }),
	});

	// a schema violation is its own hard error, not the missing-file message
	expect(error.message).not.toMatch(/no decisions found/);
});

/** A structurally clean overview file — the overview variant's own required section set. */
const cleanOverview = () => `# Drafted Plan — Overview

## Global Constraints

- None

## Phases

| # | File | Scope |
|---|------|-------|
| 1 | \`phase1-core.md\` | the core |

## Cross-Phase Dependencies

- None.
`;

test('plan draft: facts touching more paths than the phased threshold draft the overview variant', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'big', areas: [areaTouching({ modify: paths(41) })] });

	const plansDir = join(cwd, '.claude', 'plans');
	const result = await runPlanDraft({ cwd, driver: draftDriver({ bodies: [cleanOverview()] }), name: 'big', plansDir });

	expectStatus(result, 'complete');
	expect('variant' in result).toBeTruthy();
	expect(result.variant).toBe('overview');
	// the phased deliverable is authored under <plansDir>/<name>/
	expect(existsSync(join(plansDir, 'big', 'overview.md'))).toBeTruthy();
});

test('plan draft: facts at the phased threshold stay single', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'at-threshold', areas: [areaTouching({ modify: paths(40) })] });

	const plansDir = join(cwd, '.claude', 'plans');
	const result = await runPlanDraft({ cwd, driver: draftDriver({ bodies: [cleanPlan()] }), name: 'at-threshold', plansDir });

	expectStatus(result, 'complete');
	expect('variant' in result).toBeTruthy();
	expect(result.variant).toBe('single');
});

test('plan draft: a path both modified and mirrored counts once toward the scope estimate', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'overlapping', areas: [areaTouching({ modify: paths(40), mirror: ['src/mod0.ts'] })] });

	const plansDir = join(cwd, '.claude', 'plans');
	const result = await runPlanDraft({ cwd, driver: draftDriver({ bodies: [cleanPlan()] }), name: 'overlapping', plansDir });

	expectStatus(result, 'complete');
	expect('variant' in result).toBeTruthy();
	// 41 entries over 40 distinct paths stay under the threshold
	expect(result.variant).toBe('single');
});

test('plan draft: an explicit scope flag overrides the estimate', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'forced', areas: [areaTouching({ modify: paths(41) })] });

	const plansDir = join(cwd, '.claude', 'plans');
	const result = await runPlanDraft({
		cwd,
		driver: draftDriver({ bodies: [cleanPlan()] }),
		name: 'forced',
		plansDir,
		scope: PlanVariant.Single,
	});

	expectStatus(result, 'complete');
	expect('variant' in result).toBeTruthy();
	// the flag wins over the 41-path estimate
	expect(result.variant).toBe('single');
});

test('plan draft: a rate-limited author parks the run before any repair', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'parked-author' });

	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: '', exitCode: 1, rateLimited: true };
		},
	};
	const result = await runPlanDraft({ cwd, driver, name: 'parked-author', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'paused-rate-limit');
	// no re-emit retry and no repair after a rate limit
	expect(calls).toBe(1);
	// the error names the rate limit
	expect('error' in result && /rate limit/.test(result.error)).toBeTruthy();
});

test('plan draft: a rate-limited repair parks the run with the draft intact', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'parked-repair' });

	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			calls += 1;

			if (prompt.includes('# Repair input')) {
				return { text: '', exitCode: 1, rateLimited: true };
			}

			const path = outputPathFrom(prompt);

			// plan path parsed from the prompt
			expectDefined(path);
			writeFileSync(path, dirtyPlan());

			return { text: draftedReport({ path }), exitCode: 0 };
		},
	};
	const result = await runPlanDraft({ cwd, driver, name: 'parked-repair', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'paused-rate-limit');
	// the rate limit surfaced on the first repair
	expect(calls).toBe(2);
	// the draft survives on disk for the re-run to overwrite
	expect(existsSync(join(cwd, '.claude', 'plans', 'parked-repair.md'))).toBeTruthy();
});

test('plan draft: an author invocation failure returns failed with the driver error', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'author-spawn-fail' });

	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('spawn failed');
		},
	};
	const result = await runPlanDraft({ cwd, driver, name: 'author-spawn-fail', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'failed');
	// the driver error reaches the caller
	expect('error' in result && /spawn failed/.test(result.error)).toBeTruthy();
});

test('plan draft: a repair invocation failure returns failed instead of looping', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'repair-spawn-fail' });

	let calls = 0;
	const driver = draftDriver({
		bodies: [dirtyPlan()],
		onCall: () => (calls += 1),
		repair: () => {
			throw new Error('spawn failed');
		},
	});
	const result = await runPlanDraft({ cwd, driver, name: 'repair-spawn-fail', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'failed');
	// no further repairs burned after the failure
	expect(calls).toBe(2);
	// the driver error reaches the caller
	expect('error' in result && /spawn failed/.test(result.error)).toBeTruthy();
});

test('plan draft: a drafted report listing no files returns failed', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'no-files' });

	const driver: Driver = {
		name: 'stub',
		invoke: async () => ({
			text: JSON.stringify({ status: 'drafted', filesWritten: [], decisionsApplied: 0, assumptions: [], discrepancies: [] }),
			exitCode: 0,
		}),
	};
	const result = await runPlanDraft({ cwd, driver, name: 'no-files', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'failed');
	expect('error' in result && /no files written/.test(result.error)).toBeTruthy();
});

test('plan draft: a drafted report naming an unwritten file returns failed', async () => {
	const cwd = setupConsumerRepo();

	seedWorkspace({ cwd, name: 'ghost-file' });

	const plansDir = join(cwd, '.claude', 'plans');
	const ghostPath = join(plansDir, 'ghost-file.md');
	const driver: Driver = {
		name: 'stub',
		// Reports the file as written without ever writing it.
		invoke: async () => ({ text: draftedReport({ path: ghostPath }), exitCode: 0 }),
	};
	const result = await runPlanDraft({ cwd, driver, name: 'ghost-file', plansDir });

	expectStatus(result, 'failed');
	// the error names the missing file
	expect('error' in result && /not written/.test(result.error) && result.error.includes(ghostPath)).toBeTruthy();
});
