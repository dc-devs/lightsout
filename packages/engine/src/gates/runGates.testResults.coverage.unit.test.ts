import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { GateResult } from '#src/contracts/index.ts';
import { runGates } from '#src/gates/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/**
 * A gate command that writes down the results directory the engine pointed it
 * at, or the word `unset`.
 *
 * The value is written rather than merely tested for presence: this repository's
 * own suite may itself be running under lightsout, so a gate command inherits
 * that outer run's variables. What the cases below ask is whether the engine
 * gave the command a directory of *this* repo's, which the recorded path answers
 * and a presence check could not.
 */
const resultsDirProbe = "node -e \"require('fs').appendFileSync('env.log',(process.env.LIGHTSOUT_TEST_RESULTS_DIR||'unset')+'\\n')\"";

/** A consumer repo whose unit suite reports where its per-test evidence was meant to go. */
const setupProbeRepo = async () => {
	const dir = setupConsumerRepo({ scripts: { check: 'true', test: resultsDirProbe } });

	return { dir, config: await readConfig({ cwd: dir }) };
};

/** The directory the suite recorded, or 'unset' where the engine named none. */
const recordedResultsDir = ({ dir }: { dir: string }) => readFileSync(join(dir, 'env.log'), 'utf8').trim();

/** Every observation's kind and recorded results directory, in kind order. */
const recordedDirs = ({ results }: { results: GateResult[] }) =>
	results.map((result) => [result.kind, result.testResultsDir]).sort(([left], [right]) => String(left).localeCompare(String(right)));

describe('runGates', () => {
	test('runGates: names no results directory and writes no run folder without a run id', async () => {
		const { dir, config } = await setupProbeRepo();
		const results: GateResult[] = [];

		const result = await runGates({ cwd: dir, config, onGateResult: (gateResult) => results.push(gateResult) });

		expect(result.error).toBe(undefined);
		// No run folder means nowhere to write a reporter or its results, so the
		// engine points the command at nothing of its own and the reporter stays
		// inert — which is exactly what an ordinary developer run looks like.
		expect(recordedResultsDir({ dir }).startsWith(dir)).toBe(false);
		expect(existsSync(join(dir, '.lightsout'))).toBe(false);
		expect(recordedDirs({ results })).toStrictEqual([
			['check', undefined],
			['test', undefined],
		]);
	});

	test('runGates: files a step-less execution under a gates segment', async () => {
		const { dir, config } = await setupProbeRepo();
		const results: GateResult[] = [];
		const runId = 'run-stepless';

		const result = await runGates({ cwd: dir, config, runId, onGateResult: (gateResult) => results.push(gateResult) });

		const testDir = join('.lightsout', 'runs', runId, 'test-results', 'gates', 'root', 'test');

		expect(result.error).toBe(undefined);
		// A caller outside a pipeline step still gets an evidence slot per gate —
		// one named `gates` rather than one shared with whatever ran before it.
		expect(recordedResultsDir({ dir })).toBe(join(dir, testDir));
		expect(existsSync(join(dir, testDir))).toBe(true);
		expect(recordedDirs({ results })).toStrictEqual([
			['check', join('.lightsout', 'runs', runId, 'test-results', 'gates', 'root', 'check')],
			['test', testDir],
		]);
	});
});
