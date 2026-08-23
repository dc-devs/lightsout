import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { repairPlanStructure } from '#src/plan/draft/repairPlanStructure.ts';
import { advisoryPlanBody, plantAdvisoryTouchedFiles } from '#tests/helpers/advisoryPlan.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** The clean skeleton with the given placeholder markers planted — one lint finding per distinct marker. */
const planWithMarkers = ({ markers }: { markers: string }) => cleanPlanBody().replace('A new module exporting', `${markers} — a new module exporting`);

/** A drafted plan on disk plus its workspace dir, ready for the repair loop. */
const setupDraft = ({ body }: { body: string }) => {
	const cwd = setupConsumerRepo();
	const workspaceDir = join(cwd, '.lightsout', 'plans', 'demo');
	const planPath = join(workspaceDir, 'plan.md');

	mkdirSync(workspaceDir, { recursive: true });
	writeFileSync(planPath, body);

	return { cwd, workspaceDir, planPath };
};

/** A drafted plan whose 51 touched source files raise the advisory note, with the modules it edits planted so nothing else fires. */
const setupAdvisoryDraft = ({ body = advisoryPlanBody() }: { body?: string } = {}) => {
	const draft = setupDraft({ body });

	plantAdvisoryTouchedFiles({ cwd: draft.cwd });

	return draft;
};

/** A repairer that rewrites the plan with successive bodies — or hands the call to `respond` when given. */
const repairDriver = ({
	bodies = [],
	onCall,
	respond,
}: {
	bodies?: string[];
	onCall?: (prompt: string) => void;
	respond?: ({ path }: { path: string }) => { text: string; exitCode: number; rateLimited?: boolean };
}): Driver => {
	let call = 0;

	return {
		name: 'stub',
		invoke: async ({ prompt }) => {
			onCall?.(prompt);

			const path = /- (\S+plan\.md)/.exec(prompt)?.[1] ?? '';

			if (respond) {
				return respond({ path });
			}

			const body = bodies[Math.min(call, bodies.length - 1)] ?? '';

			call += 1;
			writeFileSync(path, body);

			return { text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }), exitCode: 0 };
		},
	};
};

const run = ({
	cwd,
	workspaceDir,
	planPath,
	driver,
	progress = () => {},
}: {
	cwd: string;
	workspaceDir: string;
	planPath: string;
	driver: Driver;
	progress?: (message: string) => void;
}) => repairPlanStructure({ cwd, driver, name: 'demo', planPaths: [planPath], workspaceDir, timeoutMs: 60_000, progress });

describe('repairPlanStructure', () => {
	test('a clean draft converges without spending a single repair', async () => {
		const draft = setupDraft({ body: cleanPlanBody() });
		let calls = 0;

		const result = await run({ ...draft, driver: repairDriver({ onCall: () => (calls += 1) }) });

		expectStatus(result, 'complete');
		expect('findings' in result && result.findings).toStrictEqual([]);
		expect(calls).toBe(0);
	});

	test('a dirty draft and a clean repair converge in one round', async () => {
		const draft = setupDraft({ body: planWithMarkers({ markers: 'TBD' }) });
		let calls = 0;

		const result = await run({ ...draft, driver: repairDriver({ bodies: [cleanPlanBody()], onCall: () => (calls += 1) }) });

		expectStatus(result, 'complete');
		expect('findings' in result && result.findings).toStrictEqual([]);
		expect(calls).toBe(1);
	});

	test('an advisory finding spends no repair and still comes back on the result', async () => {
		const draft = setupAdvisoryDraft();
		let calls = 0;

		const result = await run({ ...draft, driver: repairDriver({ onCall: () => (calls += 1) }) });

		expectStatus(result, 'complete');
		// an advisory is not a defect: spending one of the three attempts on it
		// would buy nothing and could cost the plan a real repair
		expect(calls).toBe(0);
		// and it still rides the complete result, because the caller prints it
		expect('findings' in result && result.findings.map(({ check, severity }) => ({ check, severity }))).toStrictEqual([
			{ check: StructuralCheck.ScopeWithinGuardrail, severity: FindingSeverity.Advisory },
		]);
	});

	test('a blocking finding beside an advisory sends only the blocking one to the repairer', async () => {
		const draft = setupAdvisoryDraft({ body: advisoryPlanBody().replace('A new module exporting', 'TBD — a new module exporting') });
		const prompts: string[] = [];

		const result = await run({ ...draft, driver: repairDriver({ bodies: [advisoryPlanBody()], onCall: (prompt) => prompts.push(prompt) }) });

		expectStatus(result, 'complete');
		expect(prompts[0]).toContain(`[${StructuralCheck.NoPlaceholders}]`);
		// telling the repairer to fix the size note would have it edit a plan that
		// has nothing wrong with it
		expect(prompts[0]).not.toContain(`[${StructuralCheck.ScopeWithinGuardrail}]`);
	});

	test('repairs that shrink but never clear the findings exhaust the three-repair budget', async () => {
		const draft = setupDraft({ body: planWithMarkers({ markers: 'TBD TODO ???' }) });
		let calls = 0;
		// 3 → 2 → 1 → 1 findings: every round is real progress, so the loop runs to
		// the cap instead of tripping the no-progress exit.
		const driver = repairDriver({
			bodies: [planWithMarkers({ markers: 'TBD TODO' }), planWithMarkers({ markers: 'TBD' }), planWithMarkers({ markers: 'TBD' })],
			onCall: () => (calls += 1),
		});

		const result = await run({ ...draft, driver });

		expectStatus(result, 'complete');
		expect(calls).toBe(3);
		// the survivors ride the result for the caller to judge
		expect('findings' in result && result.findings.length).toBe(1);
	});

	test('a repair that leaves the finding set identical stops the loop instead of burning the budget', async () => {
		const draft = setupDraft({ body: planWithMarkers({ markers: 'TBD' }) });
		let calls = 0;

		const result = await run({ ...draft, driver: repairDriver({ bodies: [planWithMarkers({ markers: 'TBD' })], onCall: () => (calls += 1) }) });

		expectStatus(result, 'complete');
		// the identical re-linted set breaks before a second repair
		expect(calls).toBe(1);
		expect('findings' in result && result.findings.length).toBe(1);
	});

	test('a surviving finding that merely drifted lines is not progress', async () => {
		const draft = setupDraft({ body: planWithMarkers({ markers: 'TBD' }) });
		let calls = 0;
		// The repair prepends prose, shifting the TBD's line number while its
		// check + issue stay identical — location is deliberately out of the key.
		const driver = repairDriver({
			bodies: [`Extra context prose that shifts every later line down.\n\n${planWithMarkers({ markers: 'TBD' })}`],
			onCall: () => (calls += 1),
		});

		const result = await run({ ...draft, driver });

		expectStatus(result, 'complete');
		// line drift alone never buys another repair
		expect(calls).toBe(1);
	});

	test('a declined repair still re-lints, so partial fixes leave only true survivors', async () => {
		// Two planted placeholders → two findings. The repair fixes TODO, declines TBD.
		const draft = setupDraft({ body: planWithMarkers({ markers: 'TBD TODO' }) });
		const driver = repairDriver({
			respond: ({ path }) => {
				writeFileSync(path, readFileSync(path, 'utf8').replace('TODO ', ''));

				return { text: JSON.stringify({ status: 'error', filesEdited: [path], discrepancies: ["'TBD' unresolvable from the inputs"] }), exitCode: 0 };
			},
		});

		const result = await run({ ...draft, driver });

		expectStatus(result, 'complete');
		// the surviving set comes from the post-repair lint, not the stale pre-repair list
		expect('findings' in result && result.findings.length).toBe(1);
		expect('findings' in result && result.findings[0]?.issue).toMatch(/TBD/);
	});

	test('a declined repair whose edits cleaned the plan returns no survivors — the lint decides, not the report', async () => {
		const draft = setupDraft({ body: planWithMarkers({ markers: 'TBD' }) });
		let calls = 0;
		const driver = repairDriver({
			respond: ({ path }) => {
				calls += 1;
				writeFileSync(path, cleanPlanBody());

				return { text: JSON.stringify({ status: 'error', filesEdited: [path], discrepancies: ['declared unresolvable, yet fixed'] }), exitCode: 0 };
			},
		});

		const result = await run({ ...draft, driver });

		expectStatus(result, 'complete');
		expect('findings' in result && result.findings).toStrictEqual([]);
		// the decline still stops the loop after its re-lint
		expect(calls).toBe(1);
	});

	test('a rate-limited repair parks with the re-run command, leaving the draft on disk', async () => {
		const draft = setupDraft({ body: planWithMarkers({ markers: 'TBD' }) });

		const result = await run({ ...draft, driver: repairDriver({ respond: () => ({ text: '', exitCode: 1, rateLimited: true }) }) });

		expectStatus(result, 'paused-rate-limit');
		expect('error' in result && result.error).toContain('lightsout plan draft --name demo');
		// the draft survives for the re-run to overwrite
		expect(readFileSync(draft.planPath, 'utf8')).toContain('TBD');
	});

	test('a repairer invocation failure returns failed instead of looping', async () => {
		const draft = setupDraft({ body: planWithMarkers({ markers: 'TBD' }) });
		const driver: Driver = {
			name: 'stub',
			invoke: async () => {
				throw new Error('spawn failed');
			},
		};

		const result = await run({ ...draft, driver });

		expectStatus(result, 'failed');
		expect('error' in result && result.error).toMatch(/spawn failed/);
	});

	test('each repair round is narrated with its number and the findings it is being spent on', async () => {
		const draft = setupDraft({ body: planWithMarkers({ markers: 'TBD TODO ???' }) });
		const messages: string[] = [];
		// 3 → 2 → 1 → 0 findings: real progress every round, so all three repairs
		// run and the loop ends on a clean plan rather than a no-progress stop
		const driver = repairDriver({
			bodies: [planWithMarkers({ markers: 'TBD TODO' }), planWithMarkers({ markers: 'TBD' }), cleanPlanBody()],
		});

		const result = await run({ ...draft, driver, progress: (message) => messages.push(message) });

		expectStatus(result, 'complete');
		// the human watching a draft converge sees the count fall round by round
		expect(messages).toEqual([
			expect.stringMatching(/3 structural finding\(s\).*repair 1\/3/),
			expect.stringMatching(/2 structural finding\(s\).*repair 2\/3/),
			expect.stringMatching(/1 structural finding\(s\).*repair 3\/3/),
		]);
	});

	test('the no-progress exit says why it stopped rather than going quiet', async () => {
		const draft = setupDraft({ body: planWithMarkers({ markers: 'TBD' }) });
		const messages: string[] = [];

		const result = await run({
			...draft,
			driver: repairDriver({ bodies: [planWithMarkers({ markers: 'TBD' })] }),
			progress: (message) => messages.push(message),
		});

		expectStatus(result, 'complete');
		// an unchanged finding set ends the loop, and the narration names the round
		expect(messages).toEqual(expect.arrayContaining([expect.stringMatching(/repair 1 made no progress/)]));
	});

	test('a declined repair narrates every discrepancy the repairer could not resolve', async () => {
		const draft = setupDraft({ body: planWithMarkers({ markers: 'TBD' }) });
		const messages: string[] = [];
		const driver = repairDriver({
			respond: ({ path }) => ({
				text: JSON.stringify({
					status: 'error',
					filesEdited: [path],
					discrepancies: ["'TBD' unresolvable from the inputs", 'the facts name no owner for this section'],
				}),
				exitCode: 0,
			}),
		});

		const result = await run({ ...draft, driver, progress: (message) => messages.push(message) });

		expectStatus(result, 'complete');
		// each decline reaches the session, which is what has to fix it by hand
		expect(messages.filter((message) => message.includes('declined'))).toEqual([
			expect.stringContaining("'TBD' unresolvable from the inputs"),
			expect.stringContaining('the facts name no owner for this section'),
		]);
	});
});
