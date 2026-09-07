import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { GateResult } from '#src/contracts/index.ts';
import { runGates } from '#src/gates/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const runId = 'run-results';
const step = 'verify-tests';

/**
 * A gate command that writes down what the engine handed it: the two reporter
 * environment variables as the command really sees them, and whether the file
 * planted in its results directory survived to the moment the command started.
 */
const envProbeCommand = ({ kind }: { kind: string }) =>
	`node -e "const fs=require('fs');const path=require('path');const dir=process.env.LIGHTSOUT_TEST_RESULTS_DIR;fs.appendFileSync('env.log',JSON.stringify({kind:'${kind}',reporter:process.env.LIGHTSOUT_JEST_REPORTER,dir:dir,stale:dir!==undefined&&fs.existsSync(path.join(dir,'stale.json'))})+'\\n')"`;

interface EnvRecord {
	kind: string;
	reporter?: string;
	dir?: string;
	stale: boolean;
}

/**
 * A consumer whose check and test gates both report their environment, with a
 * stale results file already sitting where the test gate's evidence will go —
 * left behind by an earlier attempt the checkpoint must never be judged on.
 */
const setupResultsRepo = () => {
	const dir = setupConsumerRepo({ scripts: { check: envProbeCommand({ kind: 'check' }), test: envProbeCommand({ kind: 'test' }) } });
	const staleDir = join(dir, '.lightsout', 'runs', runId, 'test-results', step, 'root', 'test');

	mkdirSync(staleDir, { recursive: true });
	writeFileSync(join(staleDir, 'stale.json'), JSON.stringify({ testResults: [] }));

	return { dir, staleDir };
};

/** The lines the probe command appended, one per gate execution, in kind order. */
const readEnvLog = ({ dir }: { dir: string }): EnvRecord[] =>
	(
		readFileSync(join(dir, 'env.log'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line)) as EnvRecord[]
	).sort((left, right) => left.kind.localeCompare(right.kind));

test('runGates: gives each gate execution its own cleared results directory and records it on the result', async () => {
	const { dir, staleDir } = setupResultsRepo();
	const results: GateResult[] = [];

	const result = await runGates({
		cwd: dir,
		config: await readConfig({ cwd: dir }),
		runId,
		step,
		onGateResult: (gateResult) => results.push(gateResult),
	});

	expect(result.error).toBe(undefined);

	const reporterPath = join(dir, '.lightsout', 'runs', runId, 'jest-reporter.cjs');
	const recorded = readEnvLog({ dir });

	// every gate execution saw both variables: the reporter file the engine
	// wrote into the run folder, and a results directory of its own, keyed by
	// the step, the group and its own gate kind — so one gate's evidence can
	// never be read as another's
	expect(recorded).toStrictEqual([
		{
			kind: 'check',
			reporter: reporterPath,
			dir: join(dir, '.lightsout', 'runs', runId, 'test-results', step, 'root', 'check'),
			stale: false,
		},
		{
			kind: 'test',
			reporter: reporterPath,
			dir: join(dir, '.lightsout', 'runs', runId, 'test-results', step, 'root', 'test'),
			stale: false,
		},
	]);
	// the reporter the variable names is really on disk — a path to nothing
	// would leave every gate command failing to load it
	expect(existsSync(reporterPath)).toBeTruthy();
	// the earlier attempt's evidence was removed before the command started, so
	// a re-run after a crash is never judged on the crashed attempt's results
	expect(existsSync(join(staleDir, 'stale.json'))).toBeFalsy();
	// and the same directory is durable evidence on the result, repo-relative
	expect(results.map((gateResult) => [gateResult.kind, gateResult.testResultsDir])).toStrictEqual([
		['check', join('.lightsout', 'runs', runId, 'test-results', step, 'root', 'check')],
		['test', join('.lightsout', 'runs', runId, 'test-results', step, 'root', 'test')],
	]);
});
