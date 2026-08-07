import { expect, describe, test } from '@jest/globals';
import { GateResult } from '@/contracts';

const setupGateResult = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const result: Record<string, unknown> = {
		kind: 'check',
		group: 'root',
		command: 'pnpm check',
		...extra,
	};

	if (omit) {
		delete result[omit];
	}

	return { result };
};

describe('GateResult', () => {
	test('a minimal entry parses to exactly its three required fields — no optional is invented', () => {
		const { result } = setupGateResult();

		const parsed = GateResult.parse(result);

		expect(parsed).toStrictEqual({ kind: 'check', group: 'root', command: 'pnpm check' });
	});

	test('kind, group, and command are each required', () => {
		for (const field of ['kind', 'group', 'command']) {
			const { result } = setupGateResult({ omit: field });

			// an entry with no ${field} names no gate a human could re-run — the evidence
			// trail is what a failed step is judged from
			expect(GateResult.safeParse(result).success).toBe(false);
		}
	});

	test('the three required fields are strings, not coerced from other types', () => {
		for (const extra of [{ kind: 1 }, { group: 1 }, { command: ['pnpm', 'check'] }]) {
			const { result } = setupGateResult({ extra });

			// a coerced label would print as evidence that no shell command matches
			expect(GateResult.safeParse(result).success).toBe(false);
		}
	});

	test('kind is an open string — an entry naming a gate outside the documented set still parses', () => {
		const { result } = setupGateResult({ extra: { kind: 'generate' } });
		const unlisted = setupGateResult({ extra: { kind: 'lint' } }).result;

		const parsed = GateResult.parse(result);
		const parsedUnlisted = GateResult.parse(unlisted);

		// generate is one of the gate kinds runGates observes
		expect(parsed.kind).toBe('generate');
		// runGates records what it ran verbatim; the closed verdict set lives in its
		// aggregate return, not in this evidence entry
		expect(parsedUnlisted.kind).toBe('lint');
	});

	test('a fully populated failure entry carries the whole audit trail through parsing intact', () => {
		const { result } = setupGateResult({
			extra: {
				kind: 'testUnit',
				group: 'api',
				command: 'pnpm testUnit',
				exitCode: 1,
				durationMs: 4200,
				rerun: true,
				outputTail: '3 tests failed',
			},
		});

		const parsed = GateResult.parse(result);

		expect(parsed).toStrictEqual({
			kind: 'testUnit',
			group: 'api',
			command: 'pnpm testUnit',
			exitCode: 1,
			durationMs: 4200,
			rerun: true,
			outputTail: '3 tests failed',
		});
	});

	test('a scoped skip parses with skipped true and its reason', () => {
		const { result } = setupGateResult({ extra: { skipped: true, reason: 'no "check" script' } });

		const parsed = GateResult.parse(result);

		expect(parsed).toStrictEqual({
			kind: 'check',
			group: 'root',
			command: 'pnpm check',
			skipped: true,
			reason: 'no "check" script',
		});
	});

	test('skipped is the literal true — a false flag is rejected rather than read as "not skipped"', () => {
		const { result } = setupGateResult({ extra: { skipped: false } });

		// presence is the signal a reader tests; a false value would make an executed
		// gate indistinguishable from a skipped one
		expect(GateResult.safeParse(result).success).toBe(false);
	});

	test('exitCode keeps both a passing zero and the -1 spawn-failure sentinel', () => {
		const passing = setupGateResult({ extra: { exitCode: 0 } }).result;
		const spawnFailure = setupGateResult({ extra: { exitCode: -1 } }).result;

		// zero is the recorded pass, not an absent code — the optional must survive a
		// falsy value
		expect(GateResult.parse(passing).exitCode).toBe(0);
		// -1 is how a spawn failure or timeout is distinguished from a command that
		// ran and returned red
		expect(GateResult.parse(spawnFailure).exitCode).toBe(-1);
	});

	test('exitCode and durationMs must be numbers — a numeric-looking string is rejected', () => {
		for (const extra of [{ exitCode: '1' }, { durationMs: '4200' }]) {
			const { result } = setupGateResult({ extra });

			// these feed comparisons and totals; a string would compare and sum as text
			expect(GateResult.safeParse(result).success).toBe(false);
		}
	});

	test('rerun records both sides of the flake re-run pair', () => {
		const first = setupGateResult({ extra: { rerun: false } }).result;
		const second = setupGateResult({ extra: { rerun: true } }).result;

		// a flake produces two entries, and the first is explicitly not the re-run
		expect(GateResult.parse(first).rerun).toBe(false);
		// the second entry is what marks the pair as one gate observed twice
		expect(GateResult.parse(second).rerun).toBe(true);
	});

	test('reason and outputTail must be strings', () => {
		for (const extra of [{ reason: 404 }, { outputTail: ['3 tests failed'] }]) {
			const { result } = setupGateResult({ extra });

			// both are printed to a human verbatim
			expect(GateResult.safeParse(result).success).toBe(false);
		}
	});

	test('keys the schema does not declare are stripped', () => {
		const { result } = setupGateResult({ extra: { exitCode: 1, stdout: 'the full untruncated log', pid: 4821 } });

		const parsed = GateResult.parse(result);

		// the entry holds the fields the contract declares, whatever else the spawn
		// happened to know — outputTail is the bounded slice a manifest keeps
		expect(parsed).toStrictEqual({ kind: 'check', group: 'root', command: 'pnpm check', exitCode: 1 });
	});
});
