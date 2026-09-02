import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { GateResult } from '#src/contracts/index.ts';
import { runGates } from '#src/gates/index.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { setupMonorepo } from '#tests/helpers/setupMonorepo.ts';

const jestWorkerSigsegv = 'A jest worker process (pid=49337) was terminated by another process: signal=SIGSEGV, exitCode=null.';
const jestWorkerSigsegvCommand = `node -e "process.stderr.write('${jestWorkerSigsegv}'); process.exit(1)"`;

interface OrdinaryFailureCase {
	label: string;
	kind: string;
	evidence: string;
	scripts: Record<string, string | false>;
	coverage?: boolean;
}

test('temporary workaround re-runs the known Jest worker SIGSEGV exactly once', async () => {
	const dir = setupConsumerRepo({ scripts: { test: jestWorkerSigsegvCommand } });
	const config = await readConfig({ cwd: dir });
	const results: GateResult[] = [];

	const result = await runGates({ cwd: dir, config, onGateResult: (result) => results.push(result) });

	expect(result.error ?? '').toContain(jestWorkerSigsegv);
	expect(result.failedFamilies).toStrictEqual(['test']);
	expect(results.filter((result) => result.kind === 'test')).toHaveLength(2);
	expect(results.filter((result) => result.rerun)).toHaveLength(1);
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
