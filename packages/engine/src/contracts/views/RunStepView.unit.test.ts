import { describe, expect, test } from '@jest/globals';
import { RunStepView } from '#src/contracts/index.ts';

const setupStepView = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const step: Record<string, unknown> = {
		id: 'implement',
		status: 'passed',
		attempts: 1,
		changedFiles: ['src/a.ts', 'src/b.ts'],
		invocations: 2,
		outputTokens: 1200,
		costUsd: 0.25,
		...extra,
	};

	if (omit) {
		delete step[omit];
	}

	return { step };
};

describe('RunStepView', () => {
	test('a step parses to the manifest record joined to its ledger totals — no optional is invented', () => {
		const { step } = setupStepView();

		const parsed = RunStepView.parse(step);

		expect(parsed).toEqual({
			id: 'implement',
			status: 'passed',
			attempts: 1,
			changedFiles: ['src/a.ts', 'src/b.ts'],
			invocations: 2,
			outputTokens: 1200,
			costUsd: 0.25,
		});
	});

	test('the record fields and the three ledger totals are each required', () => {
		for (const field of ['id', 'status', 'attempts', 'changedFiles', 'invocations', 'outputTokens', 'costUsd']) {
			const { step } = setupStepView({ omit: field });

			// the totals are unconditional: a step nothing was spent on carries zeroes,
			// so an absent one means the join never happened
			expect(RunStepView.safeParse(step).success).toBe(false);
		}
	});

	test('status accepts every run status, including the two pausable ones', () => {
		for (const status of ['pending', 'running', 'passed', 'failed', 'paused-rate-limit', 'paused-budget', 'escalated']) {
			const { step } = setupStepView({ extra: { status } });

			expect(RunStepView.parse(step).status).toBe(status);
		}
	});

	test('a status outside the run-status set fails — the enum is closed', () => {
		const { step } = setupStepView({ extra: { status: 'skipped' } });

		expect(RunStepView.safeParse(step).success).toBe(false);
	});

	test('a step that has not run carries zeroed totals and no changed files', () => {
		const { step } = setupStepView({
			extra: { status: 'pending', attempts: 0, changedFiles: [], invocations: 0, outputTokens: 0, costUsd: 0 },
		});

		const parsed = RunStepView.parse(step);

		// every count survives its own falsy value rather than reading as absent
		expect(parsed).toEqual({
			id: 'implement',
			status: 'pending',
			attempts: 0,
			changedFiles: [],
			invocations: 0,
			outputTokens: 0,
			costUsd: 0,
		});
	});

	test('a failed step carries its duration and error text through parsing intact', () => {
		const { step } = setupStepView({ extra: { status: 'failed', attempts: 2, durationMs: 4200, error: 'gate check failed' } });

		const parsed = RunStepView.parse(step);

		expect(parsed).toEqual(expect.objectContaining({ status: 'failed', attempts: 2, durationMs: 4200, error: 'gate check failed' }));
	});

	test('the report stays opaque — an arbitrary role-specific payload survives unchanged', () => {
		const report = { status: 'complete', changedFiles: [{ path: 'src/a.ts', summary: 'added' }], nested: { depth: [1, 2, 3] } };
		const { step } = setupStepView({ extra: { report } });

		const parsed = RunStepView.parse(step);

		// the role's own contract validated it already; the view hands it on whole so a
		// consumer can safeParse it against the shape it recognises
		expect(parsed.report).toStrictEqual(report);
	});

	test('a report that is not an object is still carried — the field states no shape of its own', () => {
		for (const report of ['a bare string report', 7, null]) {
			const { step } = setupStepView({ extra: { report } });

			const parsed = RunStepView.parse(step);

			expect(parsed.report).toStrictEqual(report);
		}
	});

	test('a phased step carries the phase file it implemented and the child run it spawned', () => {
		const { step } = setupStepView({ extra: { planPath: 'docs/plans/add-web-app/phase2.md', childRunId: 'a1b2c3d4-0000-4000-8000-000000000001' } });

		const parsed = RunStepView.parse(step);

		expect(parsed).toEqual(
			expect.objectContaining({
				planPath: 'docs/plans/add-web-app/phase2.md',
				childRunId: 'a1b2c3d4-0000-4000-8000-000000000001',
			}),
		);
	});

	test('a malformed changedFiles list fails rather than being coerced to strings', () => {
		for (const changedFiles of [['src/a.ts', 7], 'src/a.ts', null]) {
			const { step } = setupStepView({ extra: { changedFiles } });

			// per-step attribution feeds the run-wide union of paths
			expect(RunStepView.safeParse(step).success).toBe(false);
		}
	});

	test('the numeric fields refuse numeric-looking strings', () => {
		for (const extra of [{ attempts: '1' }, { invocations: '2' }, { outputTokens: '1200' }, { costUsd: '0.25' }, { durationMs: '4200' }]) {
			const { step } = setupStepView({ extra });

			// the detail page sums these across steps and compares them to the run total
			expect(RunStepView.safeParse(step).success).toBe(false);
		}
	});

	test('the string fields must be strings, not other types', () => {
		for (const extra of [{ id: 7 }, { error: { message: 'gate check failed' } }, { planPath: 7 }, { childRunId: 7 }]) {
			const { step } = setupStepView({ extra });

			expect(RunStepView.safeParse(step).success).toBe(false);
		}
	});

	test('keys the contract does not declare are stripped', () => {
		const { step } = setupStepView({ extra: { startedAt: '2026-01-01T00:00:00.000Z', inputTokens: 90_000 } });

		const parsed = RunStepView.parse(step);

		// only outputTokens is attributed per step; the input side lives in the run total
		expect(parsed).toEqual({
			id: 'implement',
			status: 'passed',
			attempts: 1,
			changedFiles: ['src/a.ts', 'src/b.ts'],
			invocations: 2,
			outputTokens: 1200,
			costUsd: 0.25,
		});
	});
});
