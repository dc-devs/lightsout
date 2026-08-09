import { expect, describe, test } from '@jest/globals';
import { PhaseReport } from '@/contracts';

const setupReport = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const report: Record<string, unknown> = {
		runId: '20260808-120000-a1b2c3',
		...extra,
	};

	if (omit) {
		delete report[omit];
	}

	return { report };
};

describe('PhaseReport', () => {
	test('a coordinator step report parses to exactly the child run id', () => {
		const { report } = setupReport();

		const parsed = PhaseReport.parse(report);

		expect(parsed).toStrictEqual({ runId: '20260808-120000-a1b2c3' });
	});

	test('runId is required — a report with no child run id is not a phase report', () => {
		const { report } = setupReport({ omit: 'runId' });

		// the id is the only handle the coordinator has on the run that implemented
		// the phase — without it the child manifest cannot be read back
		expect(PhaseReport.safeParse(report).success).toBe(false);
	});

	test('a non-string runId is refused rather than coerced', () => {
		const { report } = setupReport({ extra: { runId: 12345 } });

		// the id addresses a run directory on disk; a number would resolve to a
		// different path than the one that was written
		expect(PhaseReport.safeParse(report).success).toBe(false);
	});

	test('unknown keys are dropped — the parsed report carries only the run id', () => {
		const { report } = setupReport({ extra: { status: 'passed', durationMs: 4200 } });

		const parsed = PhaseReport.parse(report);

		// step.report is stored opaquely, so anything may sit alongside the id; the
		// contract narrows it to the one field the coordinator reads
		expect(parsed).toStrictEqual({ runId: '20260808-120000-a1b2c3' });
	});

	test('a report that is not an object fails instead of throwing', () => {
		for (const value of [undefined, null, 'run-1', []]) {
			// the coordinator's crash-recovery check safe-parses whatever a step
			// happens to hold — a phase that never ran holds nothing
			expect(PhaseReport.safeParse(value).success).toBe(false);
		}
	});
});
