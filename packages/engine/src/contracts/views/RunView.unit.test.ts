import { describe, expect, test } from '@jest/globals';
import { RunView } from '#src/contracts/index.ts';

const listing = {
	runId: '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0',
	shortId: '0f1e2d3c',
	pipeline: 'implement',
	status: 'passed',
	title: 'add-web-app',
	plan: 'docs/plans/add-web-app/plan.md',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T01:00:00.000Z',
	live: false,
	packages: ['engine'],
	stepsPassed: 3,
	stepCount: 3,
	changedFileCount: 2,
	resumable: false,
};

const setupView = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const view: Record<string, unknown> = {
		listing,
		harness: 'claude',
		currentStep: null,
		wallMs: 900_000,
		activeMs: 600_000,
		gateMs: 90_000,
		steps: [],
		gates: [],
		gateTotals: { commands: 0, reruns: 0, skipped: 0 },
		agents: [],
		rejectedReports: 0,
		friction: [],
		changedFiles: [],
		unreachableChangedFiles: [],
		...extra,
	};

	if (omit) {
		delete view[omit];
	}

	return { view };
};

const requiredFields = [
	'listing',
	'harness',
	'currentStep',
	'wallMs',
	'activeMs',
	'gateMs',
	'steps',
	'gates',
	'gateTotals',
	'agents',
	'rejectedReports',
	'friction',
	'changedFiles',
	'unreachableChangedFiles',
];

describe('RunView', () => {
	test('a finished run with no evidence beyond its manifest parses to exactly its required fields', () => {
		const { view } = setupView();

		const parsed = RunView.parse(view);

		// a run whose JSONL logs were never written is a normal state — empty lists,
		// not a missing payload
		expect(parsed).toStrictEqual({
			listing,
			harness: 'claude',
			currentStep: null,
			wallMs: 900_000,
			activeMs: 600_000,
			gateMs: 90_000,
			steps: [],
			gates: [],
			gateTotals: { commands: 0, reruns: 0, skipped: 0 },
			agents: [],
			rejectedReports: 0,
			friction: [],
			changedFiles: [],
			unreachableChangedFiles: [],
		});
	});

	test('every field but the four optionals is required', () => {
		for (const field of requiredFields) {
			const { view } = setupView({ omit: field });

			expect(RunView.safeParse(view).success).toBe(false);
		}
	});

	test('currentStep carries the step in flight', () => {
		const { view } = setupView({ extra: { currentStep: 'write-tests' } });

		const parsed = RunView.parse(view);

		expect(parsed.currentStep).toBe('write-tests');
	});

	test('a finished run states null rather than omitting currentStep', () => {
		const { view } = setupView();

		const parsed = RunView.parse(view);

		// null is the recorded "no step in flight", which absence could not distinguish
		// from a payload that failed to assemble
		expect(parsed.currentStep).toBeNull();
	});

	test('a currentStep that is not a step name is refused', () => {
		const { view } = setupView({ extra: { currentStep: 7 } });

		expect(RunView.safeParse(view).success).toBe(false);
	});

	test('an unparseable nested listing fails the whole payload', () => {
		const { view } = setupView({ extra: { listing: { ...listing, resumable: undefined } } });

		// the header and the sidebar row cannot disagree, so a bad row must fail the
		// payload rather than reach the page half-built
		expect(RunView.safeParse(view).success).toBe(false);
	});

	test('the same row with its resume flag intact is what the list renders', () => {
		const { view } = setupView();

		expect(RunView.safeParse(view).success).toBe(true);
	});

	test('gate lines are validated element by element', () => {
		const gate = { at: '2026-01-01T00:10:00.000Z', step: 'implement', kind: 'check', group: 'root', command: 'pnpm check', exitCode: 0 };
		const { view } = setupView({ extra: { gates: [gate] } });

		const parsed = RunView.parse(view);

		expect(parsed.gates).toStrictEqual([gate]);
	});

	test('a gate line missing its timestamp is not gate evidence', () => {
		const { view } = setupView({ extra: { gates: [{ kind: 'check', group: 'root', command: 'pnpm check' }] } });

		expect(RunView.safeParse(view).success).toBe(false);
	});

	test('agent ledger lines are validated element by element', () => {
		const agent = {
			at: '2026-01-01T00:05:00.000Z',
			step: 'implement-supervisor',
			inputTokens: 10,
			outputTokens: 100,
			cacheReadTokens: 880,
			cacheCreationTokens: 110,
			costUsd: 0.5,
			model: 'claude-opus-5',
			effort: 'high',
		};
		const { view } = setupView({ extra: { agents: [agent] } });

		const parsed = RunView.parse(view);

		expect(parsed.agents).toStrictEqual([agent]);
	});

	test('an agent line with no step attributes its spend to nothing, and is refused', () => {
		const { view } = setupView({ extra: { agents: [{ at: '2026-01-01T00:05:00.000Z', inputTokens: 10, outputTokens: 100, costUsd: 0.5 }] } });

		expect(RunView.safeParse(view).success).toBe(false);
	});

	test('steps are validated element by element, phase fields included', () => {
		const step = {
			id: 'phase2.md',
			status: 'passed',
			attempts: 1,
			changedFiles: ['src/a.ts'],
			invocations: 2,
			outputTokens: 1200,
			costUsd: 0.25,
			planPath: 'docs/plans/add-web-app/phase2.md',
			childRunId: 'a1b2c3d4-0000-4000-8000-000000000001',
		};
		const { view } = setupView({ extra: { steps: [step] } });

		const parsed = RunView.parse(view);

		expect(parsed.steps).toEqual([step]);
	});

	test('a step missing its cost never went through the ledger join, and is refused', () => {
		const { view } = setupView({ extra: { steps: [{ id: 'implement', status: 'passed', attempts: 1, changedFiles: [] }] } });

		// the join is unconditional, so a step that came out of it without a cost
		// did not come out of it
		expect(RunView.safeParse(view).success).toBe(false);
	});

	test('friction entries are carried whole, with provenance, not reduced to counts', () => {
		const record = {
			kind: 'decision',
			area: 'plan',
			detail: 'the plan named no threshold',
			at: '2026-01-01T00:20:00.000Z',
			runId: listing.runId,
			step: 'implement',
		};
		const { view } = setupView({ extra: { friction: [record] } });

		const parsed = RunView.parse(view);

		// the detail page shows each entry's kind, area and text
		expect(parsed.friction).toStrictEqual([record]);
	});

	test('an unrecognized friction area coerces to other rather than failing the whole payload', () => {
		const record = { area: 'scope', detail: 'an invented area', at: '2026-01-01T00:20:00.000Z', runId: listing.runId, step: 'implement' };
		const { view } = setupView({ extra: { friction: [record] } });

		const parsed = RunView.parse(view);

		// detail carries the real signal; a label outside the taxonomy must not take a
		// whole run's evidence down with it
		expect(parsed.friction[0]).toEqual({
			area: 'other',
			detail: 'an invented area',
			at: '2026-01-01T00:20:00.000Z',
			runId: listing.runId,
			step: 'implement',
		});
	});

	test('gateTotals requires all three counters', () => {
		for (const gateTotals of [
			{ commands: 3, reruns: 1 },
			{ commands: 3, reruns: 1, skipped: '0' },
			{ commands: 3, skipped: 0 },
		]) {
			const { view } = setupView({ extra: { gateTotals } });

			expect(RunView.safeParse(view).success).toBe(false);
		}
	});

	test('usage is the run-wide aggregate — a single-invocation envelope is refused', () => {
		const totals = { invocations: 7, inputTokens: 10, outputTokens: 100, cacheReadTokens: 880, cacheCreationTokens: 110, costUsd: 0.5 };
		const { view } = setupView({ extra: { usage: totals, cacheReadShare: 0.88 } });

		const parsed = RunView.parse(view);

		expect(parsed).toEqual(expect.objectContaining({ usage: totals, cacheReadShare: 0.88 }));
	});

	test('usage with no invocation count is one invocation’s envelope, not a run total', () => {
		const { view } = setupView({ extra: { usage: { inputTokens: 10, outputTokens: 100, cacheReadTokens: 880, cacheCreationTokens: 110, costUsd: 0.5 } } });

		expect(RunView.safeParse(view).success).toBe(false);
	});

	test('usage and cacheReadShare are both absent for a driver that reports no usage', () => {
		const { view } = setupView();

		const parsed = RunView.parse(view);

		// the engine records what it can prove and never estimates a share it has no
		// token counts for
		expect(parsed.usage).toBeUndefined();
		expect(parsed.cacheReadShare).toBeUndefined();
	});

	test('a phase child names the coordinator that spawned it, whole', () => {
		const parent = { runId: 'aaaabbbb-0000-4000-8000-000000000002', step: 'phase2.md', title: 'add-web-app' };
		const { view } = setupView({ extra: { overview: 'docs/plans/add-web-app/overview.md', parent } });

		const parsed = RunView.parse(view);

		expect(parsed).toEqual(expect.objectContaining({ overview: 'docs/plans/add-web-app/overview.md', parent }));
	});

	test('a partial parent is refused — the back link needs all three of its fields', () => {
		for (const parent of [
			{ runId: 'aaaabbbb-0000-4000-8000-000000000002', step: 'phase2.md' },
			{ runId: 'aaaabbbb', title: 'add-web-app' },
			{ step: 'phase2.md', title: 'add-web-app' },
		]) {
			const { view } = setupView({ extra: { parent } });

			expect(RunView.safeParse(view).success).toBe(false);
		}
	});

	test('the timing fields must be numbers, not numeric strings', () => {
		for (const extra of [{ wallMs: '900000' }, { activeMs: '600000' }, { gateMs: '90000' }, { rejectedReports: '0' }, { cacheReadShare: '0.88' }]) {
			const { view } = setupView({ extra });

			// wall, active and gate time are compared against each other on the page
			expect(RunView.safeParse(view).success).toBe(false);
		}
	});

	test('the two file lists must hold strings, and stay separate lists', () => {
		const { view } = setupView({ extra: { changedFiles: ['src/a.ts', 'src/b.ts'], unreachableChangedFiles: ['src/b.ts'] } });

		const parsed = RunView.parse(view);

		expect(parsed).toEqual(expect.objectContaining({ changedFiles: ['src/a.ts', 'src/b.ts'], unreachableChangedFiles: ['src/b.ts'] }));
	});

	test('a file list holding anything but strings is refused', () => {
		const { view } = setupView({ extra: { unreachableChangedFiles: [7] } });

		expect(RunView.safeParse(view).success).toBe(false);
	});

	test('harness and overview must be strings', () => {
		for (const extra of [{ harness: 7 }, { harness: null }, { overview: 7 }]) {
			const { view } = setupView({ extra });

			expect(RunView.safeParse(view).success).toBe(false);
		}
	});

	test('keys the contract does not declare are stripped', () => {
		const { view } = setupView({ extra: { manifest: { version: 3 }, lock: { pid: 4821 } } });

		const parsed = RunView.parse(view);

		// the on-disk shapes stay inside the engine; the view is the whole payload
		expect(Object.keys(parsed).sort()).toStrictEqual([...requiredFields].sort());
	});
});
