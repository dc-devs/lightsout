import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
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

		assert.deepEqual(parsed, { kind: 'check', group: 'root', command: 'pnpm check' });
	});

	test('kind, group, and command are each required', () => {
		for (const field of ['kind', 'group', 'command']) {
			const { result } = setupGateResult({ omit: field });

			assert.equal(GateResult.safeParse(result).success, false, `an entry with no ${field} names no gate a human could re-run — the evidence trail is what a failed step is judged from`);
		}
	});

	test('the three required fields are strings, not coerced from other types', () => {
		for (const extra of [{ kind: 1 }, { group: 1 }, { command: ['pnpm', 'check'] }]) {
			const { result } = setupGateResult({ extra });

			assert.equal(GateResult.safeParse(result).success, false, 'a coerced label would print as evidence that no shell command matches');
		}
	});

	test('kind is an open string — an entry naming a gate outside the documented set still parses', () => {
		const { result } = setupGateResult({ extra: { kind: 'generate' } });
		const unlisted = setupGateResult({ extra: { kind: 'lint' } }).result;

		const parsed = GateResult.parse(result);
		const parsedUnlisted = GateResult.parse(unlisted);

		assert.equal(parsed.kind, 'generate', 'generate is one of the gate kinds runGates observes');
		assert.equal(parsedUnlisted.kind, 'lint', 'runGates records what it ran verbatim; the closed verdict set lives in its aggregate return, not in this evidence entry');
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

		assert.deepEqual(parsed, {
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

		assert.deepEqual(parsed, {
			kind: 'check',
			group: 'root',
			command: 'pnpm check',
			skipped: true,
			reason: 'no "check" script',
		});
	});

	test('skipped is the literal true — a false flag is rejected rather than read as "not skipped"', () => {
		const { result } = setupGateResult({ extra: { skipped: false } });

		assert.equal(GateResult.safeParse(result).success, false, 'presence is the signal a reader tests; a false value would make an executed gate indistinguishable from a skipped one');
	});

	test('exitCode keeps both a passing zero and the -1 spawn-failure sentinel', () => {
		const passing = setupGateResult({ extra: { exitCode: 0 } }).result;
		const spawnFailure = setupGateResult({ extra: { exitCode: -1 } }).result;

		assert.equal(GateResult.parse(passing).exitCode, 0, 'zero is the recorded pass, not an absent code — the optional must survive a falsy value');
		assert.equal(GateResult.parse(spawnFailure).exitCode, -1, '-1 is how a spawn failure or timeout is distinguished from a command that ran and returned red');
	});

	test('exitCode and durationMs must be numbers — a numeric-looking string is rejected', () => {
		for (const extra of [{ exitCode: '1' }, { durationMs: '4200' }]) {
			const { result } = setupGateResult({ extra });

			assert.equal(GateResult.safeParse(result).success, false, 'these feed comparisons and totals; a string would compare and sum as text');
		}
	});

	test('rerun records both sides of the flake re-run pair', () => {
		const first = setupGateResult({ extra: { rerun: false } }).result;
		const second = setupGateResult({ extra: { rerun: true } }).result;

		assert.equal(GateResult.parse(first).rerun, false, 'a flake produces two entries, and the first is explicitly not the re-run');
		assert.equal(GateResult.parse(second).rerun, true, 'the second entry is what marks the pair as one gate observed twice');
	});

	test('reason and outputTail must be strings', () => {
		for (const extra of [{ reason: 404 }, { outputTail: ['3 tests failed'] }]) {
			const { result } = setupGateResult({ extra });

			assert.equal(GateResult.safeParse(result).success, false, 'both are printed to a human verbatim');
		}
	});

	test('keys the schema does not declare are stripped', () => {
		const { result } = setupGateResult({ extra: { exitCode: 1, stdout: 'the full untruncated log', pid: 4821 } });

		const parsed = GateResult.parse(result);

		assert.deepEqual(parsed, { kind: 'check', group: 'root', command: 'pnpm check', exitCode: 1 }, 'the entry holds the fields the contract declares, whatever else the spawn happened to know — outputTail is the bounded slice a manifest keeps');
	});
});
