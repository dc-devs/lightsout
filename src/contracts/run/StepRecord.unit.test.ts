import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { StepRecord } from '@/contracts';

const setupStep = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const step: Record<string, unknown> = {
		id: 'implement',
		status: 'running',
		attempts: 1,
		...extra,
	};

	if (omit) {
		delete step[omit];
	}

	return { step };
};

describe('StepRecord', () => {
	test('a minimal step parses to exactly its three required fields — no optional is invented', () => {
		const { step } = setupStep();

		const parsed = StepRecord.parse(step);

		assert.deepEqual(parsed, { id: 'implement', status: 'running', attempts: 1 });
	});

	test('id, status, and attempts are each required', () => {
		for (const field of ['id', 'status', 'attempts']) {
			const { step } = setupStep({ omit: field });

			assert.equal(StepRecord.safeParse(step).success, false, `a step with no ${field} cannot be resumed from — the manifest is the only state a resumed run reads`);
		}
	});

	test('status accepts every run status, including the two pausable ones', () => {
		for (const status of ['pending', 'running', 'passed', 'failed', 'paused-rate-limit', 'paused-budget', 'escalated']) {
			const { step } = setupStep({ extra: { status } });

			assert.equal(StepRecord.parse(step).status, status, `${status} is a step state the pipeline can durably record`);
		}
	});

	test('a status outside the run-status set fails — the enum is closed', () => {
		const { step } = setupStep({ extra: { status: 'skipped' } });

		assert.equal(StepRecord.safeParse(step).success, false, 'an unrecognized state would resume into a branch no step handler covers');
	});

	test('attempts must be a non-negative integer', () => {
		const zero = setupStep({ extra: { attempts: 0 } }).step;
		const negative = setupStep({ extra: { attempts: -1 } }).step;
		const fractional = setupStep({ extra: { attempts: 1.5 } }).step;

		assert.equal(StepRecord.parse(zero).attempts, 0, 'a step that has not run yet has zero attempts');
		assert.equal(StepRecord.safeParse(negative).success, false, 'a negative count would let a step exceed its retry ceiling');
		assert.equal(StepRecord.safeParse(fractional).success, false, 'attempts counts whole invocations');
	});

	test('the optional fields carry the step audit trail through parsing intact', () => {
		const { step } = setupStep({
			extra: {
				status: 'failed',
				attempts: 2,
				durationMs: 4200,
				changedFiles: ['src/a.ts', 'src/b.ts'],
				error: 'gate check failed',
			},
		});

		const parsed = StepRecord.parse(step);

		assert.deepEqual(parsed, {
			id: 'implement',
			status: 'failed',
			attempts: 2,
			durationMs: 4200,
			changedFiles: ['src/a.ts', 'src/b.ts'],
			error: 'gate check failed',
		});
	});

	test('report is stored opaquely — an arbitrary role-specific payload survives unchanged', () => {
		const report = { status: 'complete', changedFiles: [{ path: 'src/a.ts', summary: 'added' }], nested: { depth: [1, 2, 3] } };
		const { step } = setupStep({ extra: { report } });

		const parsed = StepRecord.parse(step);

		assert.deepEqual(parsed.report, report, "the role's own contract validates the report at its boundary; the manifest keeps every key it was handed");
	});

	test('a malformed changedFiles list fails rather than being coerced to strings', () => {
		const { step } = setupStep({ extra: { changedFiles: ['src/a.ts', 7] } });

		assert.equal(StepRecord.safeParse(step).success, false, 'per-step attribution feeds the run-wide union of paths — a non-path entry would flow into it');
	});
});
