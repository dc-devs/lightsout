import { describe, expect, test } from '@jest/globals';
import { GateEvidence, GateResult } from '#src/contracts/index.ts';

const setupEvidence = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const line: Record<string, unknown> = {
		at: '2026-01-01T00:00:00.000Z',
		kind: 'check',
		group: 'root',
		command: 'pnpm check',
		...extra,
	};

	if (omit) {
		delete line[omit];
	}

	return { line };
};

describe('GateEvidence', () => {
	test('a line written outside a step parses to the gate execution plus its timestamp', () => {
		const { line } = setupEvidence();

		const parsed = GateEvidence.parse(line);

		// step is absent because a preflight gate runs before any step is in flight
		expect(parsed).toStrictEqual({ at: '2026-01-01T00:00:00.000Z', kind: 'check', group: 'root', command: 'pnpm check' });
	});

	test('at is required — an undated line places no gate on the run timeline', () => {
		const { line } = setupEvidence({ omit: 'at' });

		expect(GateEvidence.safeParse(line).success).toBe(false);
	});

	test('the inherited gate fields stay required — extending adds fields, it does not relax them', () => {
		for (const field of ['kind', 'group', 'command']) {
			const { line } = setupEvidence({ omit: field });

			expect(GateEvidence.safeParse(line).success).toBe(false);
		}
	});

	test('a bare gate result is not a log line — the timestamp is what separates the contracts', () => {
		const bare = { kind: 'check', group: 'root', command: 'pnpm check' };

		expect(GateEvidence.safeParse(bare).success).toBe(false);
		// the same object is still what runGates handed its callback
		expect(GateResult.safeParse(bare).success).toBe(true);
	});

	test('a failing line carries the whole audit trail, step included, through parsing intact', () => {
		const { line } = setupEvidence({
			extra: {
				step: 'write-tests',
				kind: 'test',
				group: 'engine',
				command: 'pnpm test:unit',
				exitCode: 1,
				durationMs: 4200,
				rerun: true,
				outputTail: '3 tests failed',
			},
		});

		const parsed = GateEvidence.parse(line);

		expect(parsed).toStrictEqual({
			at: '2026-01-01T00:00:00.000Z',
			step: 'write-tests',
			kind: 'test',
			group: 'engine',
			command: 'pnpm test:unit',
			exitCode: 1,
			durationMs: 4200,
			rerun: true,
			outputTail: '3 tests failed',
		});
	});

	test('a scoped skip keeps skipped and its reason', () => {
		const { line } = setupEvidence({ extra: { step: 'implement', skipped: true, reason: 'no "check" script' } });

		const parsed = GateEvidence.parse(line);

		expect(parsed).toStrictEqual({
			at: '2026-01-01T00:00:00.000Z',
			step: 'implement',
			kind: 'check',
			group: 'root',
			command: 'pnpm check',
			skipped: true,
			reason: 'no "check" script',
		});
	});

	test('the inherited literal-true skip flag still refuses a false value', () => {
		const { line } = setupEvidence({ extra: { skipped: false } });

		// presence is the signal a reader tests; the extension must not widen it
		expect(GateEvidence.safeParse(line).success).toBe(false);
	});

	test('exitCode keeps both a passing zero and the -1 spawn-failure sentinel', () => {
		for (const exitCode of [0, -1]) {
			const { line } = setupEvidence({ extra: { exitCode } });

			const parsed = GateEvidence.parse(line);

			expect(parsed.exitCode).toBe(exitCode);
		}
	});

	test('at and step must be strings, not other types', () => {
		for (const extra of [{ at: 1_767_225_600_000 }, { step: 7 }, { step: null }]) {
			const { line } = setupEvidence({ extra });

			// both are printed beside the command a human re-runs
			expect(GateEvidence.safeParse(line).success).toBe(false);
		}
	});

	test('the inherited optional fields refuse a wrong-typed value rather than coercing it', () => {
		for (const extra of [{ exitCode: '1' }, { durationMs: '4200' }, { rerun: 'true' }, { outputTail: 7 }, { reason: 7 }]) {
			const { line } = setupEvidence({ extra });

			// durationMs is summed into the run's gate time and exitCode decides the
			// verdict, so a string here would concatenate rather than add
			expect(GateEvidence.safeParse(line).success).toBe(false);
		}
	});

	test('kind stays an open string — a gate kind outside the documented set still parses', () => {
		for (const kind of ['generate', 'build', 'testCoverage']) {
			const { line } = setupEvidence({ extra: { kind } });

			const parsed = GateEvidence.parse(line);

			expect(parsed.kind).toBe(kind);
		}
	});

	test('keys the contract does not declare are stripped', () => {
		const { line } = setupEvidence({ extra: { exitCode: 1, stdout: 'the full untruncated log', pid: 4821 } });

		const parsed = GateEvidence.parse(line);

		// outputTail is the bounded slice the log keeps, whatever else the spawn knew
		expect(parsed).toStrictEqual({
			at: '2026-01-01T00:00:00.000Z',
			kind: 'check',
			group: 'root',
			command: 'pnpm check',
			exitCode: 1,
		});
	});
});
