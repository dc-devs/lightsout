import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { FrictionRecord } from '#src/contracts/friction/FrictionRecord.ts';
import type { GateResult } from '#src/contracts/gates/GateResult.ts';
import { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
import { runGates } from '#src/gates/runGates.ts';
import { gateLogCommand } from '#tests/helpers/gateLogCommand.ts';
import { readCommandLog } from '#tests/helpers/readCommandLog.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { seedRunFolder } from '#tests/helpers/seedRunFolder.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// About a second: short for a hung gate, long enough for one meant to finish.
const ceilingMinutes = 0.02;
const ceilingConfig = { timeouts: { 'gate-minutes': ceilingMinutes } };
const hangCommand = 'sleep 30';
const redCheckCommand = `node -e "process.stderr.write('check evidence'); process.exit(1)"`;
const attemptScriptCommand = 'node attempts.cjs';

// A jest worker crash: the SIGSEGV line beside a tally that names no failing test.
const jestWorkerSigsegv = 'A jest worker process (pid=49337) was terminated by another process: signal=SIGSEGV, exitCode=null.';
const crashOutput = `${jestWorkerSigsegv}\nTest Suites: 1 failed, 3 passed, 4 total\nTests:       11 passed, 11 total`;

type AttemptEnding = 'crash' | 'hang';

/** Execution n ends as `endings[n]` says, then exits 0. Counts runs in a file, since each is a fresh process. */
const writeAttemptScript = ({ dir, endings }: { dir: string; endings: AttemptEnding[] }) => {
	writeFileSync(
		join(dir, 'attempts.cjs'),
		[
			`const fs = require('node:fs');`,
			`const seen = fs.existsSync('attempts') ? Number(fs.readFileSync('attempts', 'utf8')) : 0;`,
			`fs.writeFileSync('attempts', String(seen + 1));`,
			`const ending = ${JSON.stringify(endings)}[seen];`,
			`if (ending === 'crash') {`,
			`\tprocess.stderr.write(${JSON.stringify(crashOutput)});`,
			`\tprocess.exit(1);`,
			`}`,
			`if (ending === 'hang') {`,
			`\tsetTimeout(() => {}, 30000);`,
			`}`,
			'',
		].join('\n'),
	);
};

/** A single-package consumer under the small ceiling, its config already read. */
const setupTimeoutRepo = async ({ scripts, endings }: { scripts: Record<string, string | false>; endings?: AttemptEnding[] }) => {
	const dir = setupConsumerRepo({ scripts, config: ceilingConfig });

	if (endings) {
		writeAttemptScript({ dir, endings });
	}

	const config = await readConfig({ cwd: dir });
	const results: GateResult[] = [];
	const progress: string[] = [];

	return { dir, config, results, progress };
};

// Every package-gates command must name `{package}`; node ignores the trailing argument.
const scopedHangCommand = `node -e "setTimeout(() => {}, 30000)" {package}`;
const scopedGreenCommand = `node -e "process.exit(0)" {package}`;

/** A monorepo consumer with packages `api` and `web`, whose scoped check hangs in both. */
const setupScopedTimeoutRepo = async () => {
	const dir = setupConsumerRepo({ config: { ...ceilingConfig, 'package-gates': { check: scopedHangCommand, test: scopedGreenCommand } } });

	for (const packageDir of ['api', 'web']) {
		mkdirSync(join(dir, 'packages', packageDir), { recursive: true });
		writeFileSync(join(dir, 'packages', packageDir, 'package.json'), JSON.stringify({ name: `@acme/${packageDir}` }));
	}

	const config = await readConfig({ cwd: dir });

	return { dir, config };
};

/** The run's friction ledger, entry by entry. */
const readFriction = ({ dir }: { dir: string }) =>
	readFileSync(join(dir, '.lightsout', 'friction.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as FrictionRecord);

describe('runGates', () => {
	test('a gate that runs past its ceiling on every attempt is reported as a timeout, never as a failed family', async () => {
		const { dir, config, results } = await setupTimeoutRepo({ scripts: { check: hangCommand } });

		const result = await runGates({ cwd: dir, config, onGateResult: (gateResult) => results.push(gateResult) });

		const checks = results.filter((gateResult) => gateResult.kind === 'check');

		expect(checks.map((gateResult) => gateResult.rerun)).toStrictEqual([undefined, true]);
		expect({ failedFamilies: result.failedFamilies, crashes: result.crashes, timeouts: result.timeouts.length }).toStrictEqual({
			failedFamilies: [],
			crashes: [],
			timeouts: 1,
		});
		expect(result.timeouts[0]).toMatch(/^check timed out/);
		expect(result.timeouts[0]).toMatch(/0\.02/);
		expect(result.error).toEqual(expect.any(String));
	});

	test('a timeout that clears on its one re-run leaves the gate green and reports no timeout', async () => {
		const { dir, config, results } = await setupTimeoutRepo({ scripts: { check: attemptScriptCommand }, endings: ['hang'] });

		const result = await runGates({ cwd: dir, config, onGateResult: (gateResult) => results.push(gateResult) });

		const checks = results.filter((gateResult) => gateResult.kind === 'check');

		expect({ error: result.error, failedFamilies: result.failedFamilies, timeouts: result.timeouts }).toStrictEqual({
			error: undefined,
			failedFamilies: [],
			timeouts: [],
		});
		expect(checks.map((gateResult) => gateResult.timedOut)).toStrictEqual([true, undefined]);
	});

	test('every timed-out attempt is written to the command log and the friction ledger', async () => {
		const { dir, config } = await setupTimeoutRepo({ scripts: { check: hangCommand } });

		seedRunFolder({ cwd: dir, runId: 'r1' });

		await runGates({ cwd: dir, config, runId: 'r1', step: 'verify-implement' });

		const log = readCommandLog(dir, 'r1').filter((record) => record.kind === 'check');
		const friction = readFriction({ dir }).filter((record) => record.area === 'environment');

		expect(log.map((record) => ({ timedOut: record.timedOut, exitCode: record.exitCode }))).toStrictEqual([
			{ timedOut: true, exitCode: -1 },
			{ timedOut: true, exitCode: -1 },
		]);
		expect(friction).toHaveLength(2);

		for (const record of friction) {
			expect(record.detail).toContain('check');
			expect(record.detail).toMatch(/0\.02/);
		}
	});

	test('crash re-runs and timeout re-runs draw on separate allowances', async () => {
		const { dir, config, results } = await setupTimeoutRepo({ scripts: { test: attemptScriptCommand }, endings: ['crash', 'crash', 'hang'] });

		const result = await runGates({ cwd: dir, config, onGateResult: (gateResult) => results.push(gateResult) });

		const tests = results.filter((gateResult) => gateResult.kind === 'test');

		// one shared allowance of three would have stopped at the timeout
		expect(tests.map((gateResult) => ({ crashed: gateResult.crashed, timedOut: gateResult.timedOut, exitCode: gateResult.exitCode }))).toStrictEqual([
			{ crashed: true, timedOut: undefined, exitCode: 1 },
			{ crashed: true, timedOut: undefined, exitCode: 1 },
			{ crashed: undefined, timedOut: true, exitCode: -1 },
			{ crashed: undefined, timedOut: undefined, exitCode: 0 },
		]);
		expect({ error: result.error, crashes: result.crashes, timeouts: result.timeouts }).toStrictEqual({ error: undefined, crashes: [], timeouts: [] });
	});

	test('a timed-out attempt and its re-run are announced with the ceiling in minutes', async () => {
		const { dir, config, progress } = await setupTimeoutRepo({ scripts: { check: hangCommand } });

		await runGates({ cwd: dir, config, onProgress: (message) => progress.push(message) });

		const attemptLines = progress.filter((message) => /^gate \[root\] check( \(re-run\))?: exit/.test(message));
		const rerunLines = progress.filter((message) => /check.*re-running/.test(message));

		expect(attemptLines).toHaveLength(2);

		for (const line of attemptLines) {
			expect(line).toMatch(/timeout|timed out/);
			expect(line).toMatch(/0\.02/);
			expect(line).not.toMatch(/crash/);
		}

		expect(rerunLines).toHaveLength(1);
		expect(rerunLines[0]).toMatch(/0\.02/);
		expect(rerunLines[0]).toMatch(/attempt 2 of 2/);
		expect(rerunLines[0]).not.toMatch(/crash/);
	});

	test('a timed-out gate beside a failing gate: only the failure is a family to repair', async () => {
		const { dir, config } = await setupTimeoutRepo({ scripts: { check: redCheckCommand, test: hangCommand } });

		const result = await runGates({ cwd: dir, config, failFast: false });

		expect({ failedFamilies: result.failedFamilies, timeouts: result.timeouts.length }).toStrictEqual({ failedFamilies: ['check'], timeouts: 1 });
		expect(result.timeouts[0]).toMatch(/^test timed out/);
		expect(result.error ?? '').toMatch(/check failed \(exit 1\)/);
		expect(result.error ?? '').toMatch(/test failed \(exit -1\)/);
	});

	test('a codegen command that times out is reported as a timeout, not the generate family', async () => {
		const { dir, config } = await setupTimeoutRepo({ scripts: { generate: hangCommand, check: `${gateLogCommand({ kind: 'check' })} root` } });

		const result = await runGates({ cwd: dir, config });

		expect({ failedFamilies: result.failedFamilies, crashes: result.crashes, timeouts: result.timeouts.length }).toStrictEqual({
			failedFamilies: [],
			crashes: [],
			timeouts: 1,
		});
		expect(result.timeouts[0]).toMatch(/^generate timed out/);
		expect(result.error).toEqual(expect.any(String));
		expect(readGateLog({ dir })).toStrictEqual([]);
	});

	test('timeouts from every package group are merged into one result', async () => {
		const { dir, config } = await setupScopedTimeoutRepo();

		const result = await runGates({ cwd: dir, config, packages: ['api', 'web'] });

		const labels = result.timeouts.map((line) => /^\[(\w+)\] check timed out/.exec(line)?.[1]).sort();

		expect(labels).toStrictEqual(['api', 'web']);
		expect(result.failedFamilies).toStrictEqual([]);
	});

	test('a timed-out cheap gate holds the expensive tier and the held-tier line names the timeout', async () => {
		const { dir, config, progress } = await setupTimeoutRepo({
			scripts: {
				check: `${gateLogCommand({ kind: 'check' })} root`,
				test: hangCommand,
				'test-e2e': `${gateLogCommand({ kind: 'e2e' })} root`,
				build: `${gateLogCommand({ kind: 'build' })} root`,
			},
		});

		const result = await runGates({
			cwd: dir,
			config,
			failFast: false,
			schedule: { kind: GateScheduleKind.Tiered },
			onProgress: (message) => progress.push(message),
		});

		const heldLines = progress.filter((message) => /expensive gates not started/.test(message));

		expect({ failedFamilies: result.failedFamilies, timeouts: result.timeouts.length }).toStrictEqual({ failedFamilies: [], timeouts: 1 });
		expect(readGateLog({ dir })).toStrictEqual(['root check']);
		expect(heldLines).toHaveLength(1);
		expect(heldLines[0]).toMatch(/timeout|timed out/);
		expect(heldLines[0]).not.toMatch(/crash/);
	});

	test('a held tier whose cheap reds are a crash and a timeout names both no-verdict endings', async () => {
		const { dir, config, progress } = await setupTimeoutRepo({
			scripts: {
				check: attemptScriptCommand,
				test: hangCommand,
				'test-e2e': `${gateLogCommand({ kind: 'e2e' })} root`,
			},
			endings: ['crash', 'crash', 'crash'],
		});

		const result = await runGates({
			cwd: dir,
			config,
			failFast: false,
			schedule: { kind: GateScheduleKind.Tiered },
			onProgress: (message) => progress.push(message),
		});

		const heldLines = progress.filter((message) => /expensive gates not started/.test(message));

		expect({ failedFamilies: result.failedFamilies, crashes: result.crashes.length, timeouts: result.timeouts.length }).toStrictEqual({
			failedFamilies: [],
			crashes: 1,
			timeouts: 1,
		});
		expect(readGateLog({ dir })).toStrictEqual([]);
		expect(heldLines).toHaveLength(1);
		expect(heldLines[0]).toMatch(/\(crash, timeout\)/);
	});
});
