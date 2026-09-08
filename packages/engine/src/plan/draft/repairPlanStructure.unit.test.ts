import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import { type DecisionsRecord, FindingSeverity, LightsoutConfig, StructuralCheck } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { SyncedPlanFile } from '#src/plan/decisionLog/index.ts';
import { advisoryPlanBody, plantAdvisoryTouchedFiles } from '#tests/helpers/advisoryPlan.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { dirtyPlanBody } from '#tests/helpers/dirtyPlanBody.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { createRepairDriver, runRepairLoop, setupRepairDraft } from '#tests/helpers/repairDraftFixture.ts';

// Mocked Imports
// -------------------------
/** The sync runner as the repair loop calls it: the draft's own paths and the record it was started from, never a second read of the workspace. */
interface SyncParams {
	cwd: string;
	name: string;
	planPaths?: string[];
	decisions?: DecisionsRecord;
}

const mockSyncPlanDecisions = jest.fn<(params: SyncParams) => Promise<{ status: 'complete'; files: SyncedPlanFile[] }>>();

// The barrel re-exports this file, so both import styles reach the double.
jest.mock('#src/plan/decisionLog/syncPlanDecisions.ts', () => ({
	syncPlanDecisions: (params: SyncParams) => mockSyncPlanDecisions(params),
}));
// -------------------------

// Every round of the loop syncs before it lints. What that sync does is the
// decision-log suite's subject; here it only stands in, so no case's fixture
// body is rewritten out from under the lint that is under test.
mockSyncPlanDecisions.mockResolvedValue({ status: 'complete', files: [] });

/** A drafted plan whose 51 touched source files raise the advisory note, with the modules it edits planted so nothing else fires. */
const setupAdvisoryDraft = ({ body = advisoryPlanBody() }: { body?: string } = {}) => {
	const draft = setupRepairDraft({ body });

	plantAdvisoryTouchedFiles({ cwd: draft.cwd });

	return draft;
};

/** A repository declaring one documentation surface — the config that makes `## Documentation` a required heading. */
const declaringConfig = () =>
	LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false }, docs: [{ path: 'README.md', covers: 'The product tour.' }] });

describe('repairPlanStructure', () => {
	test('a clean draft converges without spending a single repair', async () => {
		const draft = setupRepairDraft({ body: cleanPlanBody() });
		let calls = 0;

		const result = await runRepairLoop({ ...draft, driver: createRepairDriver({ onCall: () => (calls += 1) }) });

		expectStatus(result, 'complete');
		expect('findings' in result && result.findings).toStrictEqual([]);
		expect(calls).toBe(0);
	});

	test('a dirty draft and a clean repair converge in one round', async () => {
		const draft = setupRepairDraft({ body: dirtyPlanBody({ markers: 'TBD' }) });
		let calls = 0;

		const result = await runRepairLoop({ ...draft, driver: createRepairDriver({ bodies: [cleanPlanBody()], onCall: () => (calls += 1) }) });

		expectStatus(result, 'complete');
		expect('findings' in result && result.findings).toStrictEqual([]);
		expect(calls).toBe(1);
	});

	test('a repository declaring documentation surfaces sends the repairer the list it must choose from', async () => {
		// the same body the undeclared cases lint clean: the missing heading is
		// the repository's own config asking for it
		const draft = setupRepairDraft({ body: cleanPlanBody() });
		const prompts: string[] = [];
		const driver = createRepairDriver({
			bodies: [cleanPlanBody({ documentation: 'Nothing user-facing — no docs needed.' })],
			onCall: (prompt) => prompts.push(prompt),
		});

		const result = await runRepairLoop({ ...draft, driver, config: declaringConfig() });

		expectStatus(result, 'complete');
		expect('findings' in result && result.findings).toStrictEqual([]);
		expect(prompts[0]).toContain("add a '## Documentation' section");
		// the repair role forbids inventing a document, so the declared surface and
		// what it covers travel with the finding rather than being guessed at
		expect(prompts[0]).toContain('- `README.md` — The product tour.');
	});

	test('an advisory finding spends no repair and still comes back on the result', async () => {
		const draft = setupAdvisoryDraft();
		let calls = 0;

		const result = await runRepairLoop({ ...draft, driver: createRepairDriver({ onCall: () => (calls += 1) }) });

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

		const result = await runRepairLoop({ ...draft, driver: createRepairDriver({ bodies: [advisoryPlanBody()], onCall: (prompt) => prompts.push(prompt) }) });

		expectStatus(result, 'complete');
		expect(prompts[0]).toContain(`[${StructuralCheck.NoPlaceholders}]`);
		// telling the repairer to fix the size note would have it edit a plan that
		// has nothing wrong with it
		expect(prompts[0]).not.toContain(`[${StructuralCheck.ScopeWithinGuardrail}]`);
	});

	test('repairs that shrink but never clear the findings exhaust the three-repair budget', async () => {
		const draft = setupRepairDraft({ body: dirtyPlanBody({ markers: 'TBD TODO ???' }) });
		let calls = 0;
		// 3 → 2 → 1 → 1 findings: every round is real progress, so the loop runs to
		// the cap instead of tripping the no-progress exit.
		const driver = createRepairDriver({
			bodies: [dirtyPlanBody({ markers: 'TBD TODO' }), dirtyPlanBody({ markers: 'TBD' }), dirtyPlanBody({ markers: 'TBD' })],
			onCall: () => (calls += 1),
		});

		const result = await runRepairLoop({ ...draft, driver });

		expectStatus(result, 'complete');
		expect(calls).toBe(3);
		// the survivors ride the result for the caller to judge
		expect('findings' in result && result.findings.length).toBe(1);
	});

	test('a repair that leaves the finding set identical stops the loop instead of burning the budget', async () => {
		const draft = setupRepairDraft({ body: dirtyPlanBody({ markers: 'TBD' }) });
		let calls = 0;

		const result = await runRepairLoop({ ...draft, driver: createRepairDriver({ bodies: [dirtyPlanBody({ markers: 'TBD' })], onCall: () => (calls += 1) }) });

		expectStatus(result, 'complete');
		// the identical re-linted set breaks before a second repair
		expect(calls).toBe(1);
		expect('findings' in result && result.findings.length).toBe(1);
	});

	test('a surviving finding that merely drifted lines is not progress', async () => {
		const draft = setupRepairDraft({ body: dirtyPlanBody({ markers: 'TBD' }) });
		let calls = 0;
		// The repair prepends prose, shifting the TBD's line number while its
		// check + issue stay identical — location is deliberately out of the key.
		const driver = createRepairDriver({
			bodies: [`Extra context prose that shifts every later line down.\n\n${dirtyPlanBody({ markers: 'TBD' })}`],
			onCall: () => (calls += 1),
		});

		const result = await runRepairLoop({ ...draft, driver });

		expectStatus(result, 'complete');
		// line drift alone never buys another repair
		expect(calls).toBe(1);
	});

	test('a declined repair still re-lints, so partial fixes leave only true survivors', async () => {
		// Two planted placeholders → two findings. The repair fixes TODO, declines TBD.
		const draft = setupRepairDraft({ body: dirtyPlanBody({ markers: 'TBD TODO' }) });
		const driver = createRepairDriver({
			respond: ({ path }) => {
				writeFileSync(path, readFileSync(path, 'utf8').replace('TODO ', ''));

				return { text: JSON.stringify({ status: 'error', filesEdited: [path], discrepancies: ["'TBD' unresolvable from the inputs"] }), exitCode: 0 };
			},
		});

		const result = await runRepairLoop({ ...draft, driver });

		expectStatus(result, 'complete');
		// the surviving set comes from the post-repair lint, not the stale pre-repair list
		expect('findings' in result && result.findings.length).toBe(1);
		expect('findings' in result && result.findings[0]?.issue).toMatch(/TBD/);
	});

	test('a declined repair whose edits cleaned the plan returns no survivors — the lint decides, not the report', async () => {
		const draft = setupRepairDraft({ body: dirtyPlanBody({ markers: 'TBD' }) });
		let calls = 0;
		const driver = createRepairDriver({
			respond: ({ path }) => {
				calls += 1;
				writeFileSync(path, cleanPlanBody());

				return { text: JSON.stringify({ status: 'error', filesEdited: [path], discrepancies: ['declared unresolvable, yet fixed'] }), exitCode: 0 };
			},
		});

		const result = await runRepairLoop({ ...draft, driver });

		expectStatus(result, 'complete');
		expect('findings' in result && result.findings).toStrictEqual([]);
		// the decline still stops the loop after its re-lint
		expect(calls).toBe(1);
	});

	test('a rate-limited repair parks with the re-run command, leaving the draft on disk', async () => {
		const draft = setupRepairDraft({ body: dirtyPlanBody({ markers: 'TBD' }) });

		const result = await runRepairLoop({ ...draft, driver: createRepairDriver({ respond: () => ({ text: '', exitCode: 1, rateLimited: true }) }) });

		expectStatus(result, 'paused-rate-limit');
		expect('error' in result && result.error).toContain('lightsout plan draft --name demo');
		// the draft survives for the re-run to overwrite
		expect(readFileSync(draft.planPath, 'utf8')).toContain('TBD');
	});

	test('a repairer invocation failure returns failed instead of looping', async () => {
		const draft = setupRepairDraft({ body: dirtyPlanBody({ markers: 'TBD' }) });
		const driver: Driver = {
			name: 'stub',
			invoke: async () => {
				throw new Error('spawn failed');
			},
		};

		const result = await runRepairLoop({ ...draft, driver });

		expectStatus(result, 'failed');
		expect('error' in result && result.error).toMatch(/spawn failed/);
	});

	test('each repair round is narrated with its number and the findings it is being spent on', async () => {
		const draft = setupRepairDraft({ body: dirtyPlanBody({ markers: 'TBD TODO ???' }) });
		const messages: string[] = [];
		// 3 → 2 → 1 → 0 findings: real progress every round, so all three repairs
		// run and the loop ends on a clean plan rather than a no-progress stop
		const driver = createRepairDriver({
			bodies: [dirtyPlanBody({ markers: 'TBD TODO' }), dirtyPlanBody({ markers: 'TBD' }), cleanPlanBody()],
		});

		const result = await runRepairLoop({ ...draft, driver, progress: (message) => messages.push(message) });

		expectStatus(result, 'complete');
		// the human watching a draft converge sees the count fall round by round
		expect(messages).toEqual([
			expect.stringMatching(/3 structural finding\(s\).*repair 1\/3/),
			expect.stringMatching(/2 structural finding\(s\).*repair 2\/3/),
			expect.stringMatching(/1 structural finding\(s\).*repair 3\/3/),
		]);
	});

	test('the no-progress exit says why it stopped rather than going quiet', async () => {
		const draft = setupRepairDraft({ body: dirtyPlanBody({ markers: 'TBD' }) });
		const messages: string[] = [];

		const result = await runRepairLoop({
			...draft,
			driver: createRepairDriver({ bodies: [dirtyPlanBody({ markers: 'TBD' })] }),
			progress: (message) => messages.push(message),
		});

		expectStatus(result, 'complete');
		// an unchanged finding set ends the loop, and the narration names the round
		expect(messages).toEqual(expect.arrayContaining([expect.stringMatching(/repair 1 made no progress/)]));
	});

	test('a declined repair narrates every discrepancy the repairer could not resolve', async () => {
		const draft = setupRepairDraft({ body: dirtyPlanBody({ markers: 'TBD' }) });
		const messages: string[] = [];
		const driver = createRepairDriver({
			respond: ({ path }) => ({
				text: JSON.stringify({
					status: 'error',
					filesEdited: [path],
					discrepancies: ["'TBD' unresolvable from the inputs", 'the facts name no owner for this section'],
				}),
				exitCode: 0,
			}),
		});

		const result = await runRepairLoop({ ...draft, driver, progress: (message) => messages.push(message) });

		expectStatus(result, 'complete');
		// each decline reaches the session, which is what has to fix it by hand
		expect(messages.filter((message) => message.includes('declined'))).toEqual([
			expect.stringContaining("'TBD' unresolvable from the inputs"),
			expect.stringContaining('the facts name no owner for this section'),
		]);
	});
});
