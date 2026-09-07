import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { GateResult } from '#src/contracts/index.ts';
import { checkTestResultsCapability } from '#src/gates/index.ts';

/**
 * A repo whose gate executions each ran a command and came back with an exit
 * code, and none of which recorded a results directory at all — the shape an
 * execution takes when the engine had no run folder to give it.
 */
const setupProbe = ({ executions }: { executions: { kind: string; group?: string; exitCode?: number }[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-capability-coverage-'));
	const progress: string[] = [];
	const results: GateResult[] = executions.map(({ kind, group = 'root', exitCode = 0 }) => ({ kind, group, command: `gate ${kind}`, exitCode }));

	return { cwd, results, progress, onProgress: (message: string) => progress.push(message) };
};

describe('checkTestResultsCapability', () => {
	test('checkTestResultsCapability: fails a ledger gate whose green execution recorded no results directory', async () => {
		const { cwd, results, progress, onProgress } = setupProbe({ executions: [{ kind: 'test', group: 'api' }] });

		const error = await checkTestResultsCapability({ cwd, gates: ['test'], results, onProgress });

		// A green gate with no evidence slot of its own proves no more than one that
		// wrote an empty slot, so it is the same failure — and the gate did run, so
		// it is a failure rather than the skip a gate that never ran gets.
		expect(error).toEqual(expect.stringContaining('api'));
		expect(error).toEqual(expect.stringContaining('LIGHTSOUT_JEST_REPORTER'));
		expect(progress).toStrictEqual([]);
	});

	test('checkTestResultsCapability: answers undefined when the plan names no ledger gate', async () => {
		const { cwd, results, progress, onProgress } = setupProbe({ executions: [{ kind: 'test' }] });

		const error = await checkTestResultsCapability({ cwd, gates: [], results, onProgress });

		// A plan with no acceptance ledger has nothing to prove, so the same silent
		// gate that fails the case above is not looked at here at all.
		expect(error).toBe(undefined);
		expect(progress).toStrictEqual([]);
	});
});
