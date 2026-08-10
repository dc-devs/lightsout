import { describe, expect, test } from '@jest/globals';
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

		expect(parsed).toStrictEqual({ id: 'implement', status: 'running', attempts: 1 });
	});

	test('id, status, and attempts are each required', () => {
		for (const field of ['id', 'status', 'attempts']) {
			const { step } = setupStep({ omit: field });

			// a step with no ${field} cannot be resumed from — the manifest is the only
			// state a resumed run reads
			expect(StepRecord.safeParse(step).success).toBe(false);
		}
	});

	test('status accepts every run status, including the two pausable ones', () => {
		for (const status of ['pending', 'running', 'passed', 'failed', 'paused-rate-limit', 'paused-budget', 'escalated']) {
			const { step } = setupStep({ extra: { status } });

			// ${status} is a step state the pipeline can durably record
			expect(StepRecord.parse(step).status).toBe(status);
		}
	});

	test('a status outside the run-status set fails — the enum is closed', () => {
		const { step } = setupStep({ extra: { status: 'skipped' } });

		// an unrecognized state would resume into a branch no step handler covers
		expect(StepRecord.safeParse(step).success).toBe(false);
	});

	test('attempts must be a non-negative integer', () => {
		const zero = setupStep({ extra: { attempts: 0 } }).step;
		const negative = setupStep({ extra: { attempts: -1 } }).step;
		const fractional = setupStep({ extra: { attempts: 1.5 } }).step;

		// a step that has not run yet has zero attempts
		expect(StepRecord.parse(zero).attempts).toBe(0);
		// a negative count would let a step exceed its retry ceiling
		expect(StepRecord.safeParse(negative).success).toBe(false);
		// attempts counts whole invocations
		expect(StepRecord.safeParse(fractional).success).toBe(false);
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

		expect(parsed).toStrictEqual({
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

		// the role's own contract validates the report at its boundary; the manifest
		// keeps every key it was handed
		expect(parsed.report).toStrictEqual(report);
	});

	test('a malformed changedFiles list fails rather than being coerced to strings', () => {
		const { step } = setupStep({ extra: { changedFiles: ['src/a.ts', 7] } });

		// per-step attribution feeds the run-wide union of paths — a non-path entry
		// would flow into it
		expect(StepRecord.safeParse(step).success).toBe(false);
	});
});
