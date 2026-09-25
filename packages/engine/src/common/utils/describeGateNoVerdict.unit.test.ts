import { describe, expect, test } from '@jest/globals';
import { describeGateNoVerdict } from '#src/common/utils/describeGateNoVerdict.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';

const crashLine = 'test crashed: on every attempt Jest died without reporting a failing test, so this gate never returned a verdict.';
const timeoutLine = 'test-e2e timed out: every attempt ran past the 15-minute gate ceiling (timeouts.gate-minutes), so this gate never returned a verdict.';

const setupResult = (overrides: Partial<GateRunResult> = {}): GateRunResult => ({
	error: undefined,
	failedFamilies: [],
	crashes: [],
	timeouts: [],
	coordination: undefined,
	...overrides,
});

describe('describeGateNoVerdict', () => {
	test.each([
		{ label: 'a green run', overrides: {} },
		{ label: 'a red run with a failed family', overrides: { error: 'check: exit 1', failedFamilies: ['check'] } },
	])('answers undefined for $label, because it is a verdict', ({ overrides }) => {
		const result = setupResult(overrides);

		const reason = describeGateNoVerdict({ result });

		expect(reason).toBe(undefined);
	});

	test('answers the coordination reason unchanged, ahead of a crash or a timeout', () => {
		const result = setupResult({
			error: 'gates never started',
			coordination: 'another run of this repository holds the machine',
			crashes: [crashLine],
			timeouts: [timeoutLine],
		});

		const reason = describeGateNoVerdict({ result });

		expect(reason).toBe('another run of this repository holds the machine');
	});

	test('names the crash ahead of a timeout in the same run, with the full gate output beside it', () => {
		const gateOutput = 'test: exit 139 (SIGSEGV)\n\ntest-e2e: exit -1 (timeout at the 15-minute ceiling)';
		const result = setupResult({ error: gateOutput, crashes: [crashLine], timeouts: [timeoutLine] });

		const reason = describeGateNoVerdict({ result }) ?? '';

		expect(reason.startsWith(crashLine)).toBe(true);
		expect(reason).not.toContain(timeoutLine);
		expect(reason).toContain(gateOutput);
		expect(reason).not.toMatch(/still red/);
	});

	test('names the timeout lines and the gate output when no gate crashed', () => {
		const result = setupResult({ error: 'test-e2e: exit -1 (timeout at the 15-minute ceiling)', timeouts: [timeoutLine] });

		const reason = describeGateNoVerdict({ result }) ?? '';

		expect(reason.startsWith(timeoutLine)).toBe(true);
		expect(reason).toMatch(/no fix attempt was spent/i);
		expect(reason).toContain('test-e2e: exit -1 (timeout at the 15-minute ceiling)');
	});

	test('keeps a timeout reason whole when the run carries no gate output', () => {
		const result = setupResult({ timeouts: [timeoutLine] });

		const reason = describeGateNoVerdict({ result }) ?? '';

		expect(reason.startsWith(timeoutLine)).toBe(true);
		expect(reason).not.toContain('undefined');
	});
});
