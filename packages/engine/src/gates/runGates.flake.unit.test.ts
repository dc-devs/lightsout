import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { FrictionRecord, GateResult } from '#src/contracts/index.ts';
import { runGates } from '#src/gates/index.ts';
import { readCommandLog } from '#tests/helpers/readCommandLog.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { setupMonorepo } from '#tests/helpers/setupMonorepo.ts';

const jestWorkerSigsegv = 'A jest worker process (pid=49337) was terminated by another process: signal=SIGSEGV, exitCode=null.';
// The crash as it really arrives: jest still prints its tally, and the tally
// says no test failed. That is what tells a crash from a broken suite.
const crashTally = 'Test Suites: 1 failed, 3 passed, 4 total\\nTests:       11 passed, 11 total';
const crashWithTallyCommand = `node -e "process.stderr.write('${jestWorkerSigsegv}\\n${crashTally}'); process.exit(1)"`;
const failingTestTally = 'Test Suites: 2 failed, 2 passed, 4 total\\nTests:       1 failed, 10 passed, 11 total';
const crashBesideFailingTestCommand = `node -e "process.stderr.write('${jestWorkerSigsegv}\\n${failingTestTally}'); process.exit(1)"`;
/** Attempts a crashing gate is given before the engine calls the crash unabsorbable. */
const gateCrashAttempts = 3;
const crashOnceCommand = 'node flaky.cjs';
// The other shape, seen on 2026-09-04: one package's Jest goes down mid-run and
// says nothing at all. The tally that survives belongs to the packages that did
// finish, so the runner plainly ran — and nothing anywhere tallies a failed test.
const silentDeathTally = 'Test Suites: 154 passed, 154 total\\nTests:       1324 passed, 1324 total';
const silentDeathCommand = `node -e "process.stdout.write('${silentDeathTally}'); process.exit(1)"`;
// The same silence from a command that is not Jest at all: no suite line, so
// nothing says a test runner was ever involved.
const nonJestFailureCommand = `node -e "process.stderr.write('build tool exploded'); process.exit(1)"`;

/** Plant the command `crashOnceCommand` names: it crashes on its first execution and passes on every one after. */
const writeCrashOnceScript = ({ dir }: { dir: string }) => {
	const crashOutput = `${jestWorkerSigsegv}\n${crashTally.split('\\n').join('\n')}`;

	writeFileSync(
		join(dir, 'flaky.cjs'),
		[
			`const fs = require('node:fs');`,
			`const seen = fs.existsSync('attempts') ? Number(fs.readFileSync('attempts', 'utf8')) : 0;`,
			`fs.writeFileSync('attempts', String(seen + 1));`,
			`if (seen === 0) {`,
			`\tprocess.stderr.write(${JSON.stringify(crashOutput)});`,
			`\tprocess.exit(1);`,
			`}`,
			'',
		].join('\n'),
	);
};

interface OrdinaryFailureCase {
	label: string;
	kind: string;
	evidence: string;
	scripts: Record<string, string | false>;
	coverage?: boolean;
}

test('a worker crash that clears on a re-run leaves the gate green and reports no crash', async () => {
	const dir = setupConsumerRepo({ scripts: { test: crashOnceCommand } });

	writeCrashOnceScript({ dir });

	const config = await readConfig({ cwd: dir });
	const results: GateResult[] = [];

	const result = await runGates({ cwd: dir, config, onGateResult: (result) => results.push(result) });

	// the crash cost a second execution and nothing else: the re-run is the
	// whole remedy when the toolchain lets go
	expect(result.error).toBe(undefined);
	expect(result.failedFamilies).toStrictEqual([]);
	expect(result.crashes).toStrictEqual([]);
	expect(results.filter((result) => result.kind === 'test')).toHaveLength(2);
	expect(results.filter((result) => result.crashed)).toHaveLength(1);
});

test('a test runner that dies without naming a signal is re-run, because nothing tallied a failing test', async () => {
	// Jest going down mid-run prints no signal and no error — one package's
	// banner, then silence — so matching the SIGSEGV line misses it entirely and
	// the run escalated on a suite that was never broken.
	const dir = setupConsumerRepo({ scripts: { test: silentDeathCommand } });
	const config = await readConfig({ cwd: dir });
	const results: GateResult[] = [];

	await runGates({ cwd: dir, config, onGateResult: (result) => results.push(result) });

	expect(results.filter((result) => result.kind === 'test')).toHaveLength(gateCrashAttempts);
	expect(results.filter((result) => result.crashed)).toHaveLength(gateCrashAttempts);
});

test('a test command that fails without the test runner reporting at all is ordinary evidence, not a death', async () => {
	// No suite line means no runner ran, so the red belongs to whatever did fail
	// and a fix agent should see it rather than have it re-run three times.
	const dir = setupConsumerRepo({ scripts: { test: nonJestFailureCommand } });
	const config = await readConfig({ cwd: dir });
	const results: GateResult[] = [];

	const result = await runGates({ cwd: dir, config, onGateResult: (result) => results.push(result) });

	expect(results.filter((result) => result.kind === 'test')).toHaveLength(1);
	expect(results.filter((result) => result.crashed)).toHaveLength(0);
	expect(result.failedFamilies).toStrictEqual(['test']);
});

test('a worker crash on every attempt is reported as a crash, never as a failing test family', async () => {
	const dir = setupConsumerRepo({ scripts: { test: crashWithTallyCommand } });
	const config = await readConfig({ cwd: dir });
	const results: GateResult[] = [];

	const result = await runGates({ cwd: dir, config, onGateResult: (result) => results.push(result) });

	// one re-run was not enough on 2026-08-24, so the gate is given a budget;
	// what it never becomes is a family a fix agent is asked to repair
	expect(results.filter((result) => result.kind === 'test')).toHaveLength(gateCrashAttempts);
	expect(results.filter((result) => result.rerun)).toHaveLength(gateCrashAttempts - 1);
	expect(result.failedFamilies).toStrictEqual([]);
	expect(result.crashes).toHaveLength(1);
	expect(result.crashes[0]).toContain('crashed');
	// still red, so a caller reading only `error` cannot ship an unverified tree
	expect(result.error ?? '').toContain(jestWorkerSigsegv);
});

test('a worker crash beside a failing test is a real failure — not re-run, not absorbed', async () => {
	const dir = setupConsumerRepo({ scripts: { test: crashBesideFailingTestCommand } });
	const config = await readConfig({ cwd: dir });
	const results: GateResult[] = [];

	const result = await runGates({ cwd: dir, config, onGateResult: (result) => results.push(result) });

	// the tally names a failing test, which is evidence about the code —
	// absorbing this red would hide a broken suite behind a known crash
	expect(results.filter((result) => result.kind === 'test')).toHaveLength(1);
	expect(result.failedFamilies).toStrictEqual(['test']);
	expect(result.crashes).toStrictEqual([]);
	expect(results.filter((result) => result.crashed)).toHaveLength(0);
});

test('every crashing attempt is written to the command log and the friction ledger', async () => {
	const dir = setupConsumerRepo({ scripts: { test: crashWithTallyCommand } });
	const config = await readConfig({ cwd: dir });

	await runGates({ cwd: dir, config, runId: 'r1', step: 'verify-implement' });

	const log = readCommandLog(dir, 'r1').filter((record) => record.kind === 'test');
	const friction = readFileSync(join(dir, '.lightsout', 'friction.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as FrictionRecord);

	// the crash is on the durable record either way it ends — an absorbed one
	// leaves no other trace an operator could find afterwards
	expect(log.map((record) => record.crashed)).toStrictEqual([true, true, true]);
	expect(friction).toHaveLength(gateCrashAttempts);
	expect(friction[0]?.runId).toBe('r1');
	expect(friction[0]?.step).toBe('verify-implement');
	expect(friction[0]?.area).toBe('environment');
	expect(friction[0]?.detail).toContain('SIGSEGV');
});

const ordinaryFailureCases: OrdinaryFailureCase[] = [
	{
		label: 'check',
		kind: 'check',
		evidence: 'check evidence',
		scripts: { check: `node -e "process.stderr.write('check evidence'); process.exit(1)"` },
	},
	{
		label: 'test',
		kind: 'test',
		evidence: 'test evidence',
		scripts: { test: `node -e "process.stderr.write('test evidence'); process.exit(1)"` },
	},
	{
		label: 'coverage',
		kind: 'testCoverage',
		evidence: 'coverage evidence',
		scripts: { 'test-coverage': `node -e "process.stderr.write('coverage evidence'); process.exit(1)"` },
		coverage: true,
	},
	{
		label: 'end-to-end',
		kind: 'test-e2e',
		evidence: 'end-to-end evidence',
		scripts: { 'test-e2e': `node -e "process.stderr.write('end-to-end evidence'); process.exit(1)"` },
	},
];

describe.each(ordinaryFailureCases)('ordinary nonzero $label gate', ({ kind, evidence, scripts, coverage }) => {
	test('is not re-run and preserves its original repair and artifact evidence', async () => {
		const dir = setupConsumerRepo({ scripts });
		const config = await readConfig({ cwd: dir });
		const results: GateResult[] = [];

		const { error, failedFamilies } = await runGates({
			cwd: dir,
			config,
			coverage,
			runId: 'r1',
			step: 'verify',
			onGateResult: (result) => results.push(result),
		});
		const matchingResults = results.filter((result) => result.kind === kind);
		const log = readFileSync(join(dir, '.lightsout', 'runs', 'r1', 'commands.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>)
			.filter((record) => record.kind === kind);

		expect(matchingResults).toHaveLength(1);
		expect(matchingResults[0]?.rerun).toBe(undefined);
		expect(matchingResults[0]?.outputTail ?? '').toContain(evidence);
		expect(error ?? '').toContain(evidence);
		expect(failedFamilies).toStrictEqual([kind]);
		expect(log).toHaveLength(1);
		expect(log[0]?.rerun).toBe(undefined);
		expect(log[0]?.outputTail).toContain(evidence);
	});
});

test('coverage replaces the plain test run in gate sets that include it', async () => {
	const dir = setupMonorepo();
	const config = await readConfig({ cwd: dir });

	const withCoverage = await runGates({ cwd: dir, config, packages: ['api'], includeRoot: true, coverage: true });

	expect(withCoverage.error).toBe(undefined);

	const coveredLines = readGateLog({ dir });

	// coverage replaced the plain test and root precedence kept the affected
	// package group out of this mixed-scope run
	expect(coveredLines).toStrictEqual(['root check', 'root coverage']);

	const withoutCoverage = await runGates({ cwd: dir, config, packages: ['api'], includeRoot: true });

	expect(withoutCoverage.error).toBe(undefined);

	const allLines = readGateLog({ dir }).slice(coveredLines.length);

	// without coverage, the root group's plain test returns and the affected
	// package group remains superseded
	expect(allLines).toStrictEqual(['root check', 'root test']);
});

test('root group supersedes all affected-package groups in a mixed scope', async () => {
	const dir = setupMonorepo();
	const config = await readConfig({ cwd: dir });

	const { error } = await runGates({
		cwd: dir,
		config,
		packages: ['api', 'web'],
		includeRoot: true,
	});

	expect(error).toBe(undefined);

	const lines = readGateLog({ dir });

	expect(lines).toStrictEqual(['root check', 'root test']);
	expect(lines.some((line) => line.startsWith('@acme/api '))).toBeFalsy();
	expect(lines.some((line) => line.startsWith('@acme/web '))).toBeFalsy();
});
