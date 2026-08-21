import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { runGates } from '#src/pipeline/index.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { setupMonorepo } from '#tests/helpers/setupMonorepo.ts';

/** Fails on first execution, passes on the second — a one-shot flake. */
const flakyCommand = `node -e "const fs=require('fs'); if (fs.existsSync('flaked')) process.exit(0); fs.writeFileSync('flaked',''); process.exit(1)"`;

test('a red gate is re-run once — a one-shot flake does not fail the gate set', async () => {
	const dir = setupConsumerRepo({ scripts: { test: flakyCommand } });
	const config = await readConfig({ cwd: dir });

	const error = await runGates({ cwd: dir, config });

	// flake absorbed by the mechanical re-run
	expect(error).toBe(undefined);
});

test('two consecutive reds are a genuine red, both executions in the command log', async () => {
	const dir = setupConsumerRepo({ scripts: { test: 'node -e "process.exit(1)"' } });
	const config = await readConfig({ cwd: dir });

	const error = await runGates({ cwd: dir, config, runId: 'r1', step: 'verify' });

	expect(error ?? '').toMatch(/test failed/);

	const log = readFileSync(join(dir, '.lightsout', 'runs', 'r1', 'commands.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.filter((record) => record.kind === 'test');

	// both executions logged
	expect(log.length).toBe(2);
	expect(log[0].rerun).toBe(undefined);
	expect(log[1].rerun).toBe(true);
});

test('coverage replaces the plain test run in gate sets that include it', async () => {
	const dir = setupMonorepo();
	const config = await readConfig({ cwd: dir });

	const withCoverage = await runGates({ cwd: dir, config, packages: ['api'], includeRoot: true, coverage: true });

	expect(withCoverage).toBe(undefined);

	const coveredLines = readGateLog({ dir });

	// coverage ran
	expect(coveredLines.some((line) => line.endsWith(' coverage'))).toBeTruthy();
	// plain test run replaced — same suites, one fleet
	expect(coveredLines.some((line) => line.endsWith(' test'))).toBeFalsy();

	const withoutCoverage = await runGates({ cwd: dir, config, packages: ['api'], includeRoot: true });

	expect(withoutCoverage).toBe(undefined);

	const allLines = readGateLog({ dir }).slice(coveredLines.length);

	// plain test run returns when the set has no coverage
	expect(allLines.some((line) => line.endsWith(' test'))).toBeTruthy();
	// no coverage outside coverage sets
	expect(allLines.some((line) => line.endsWith(' coverage'))).toBeFalsy();
});

test('root group runs after the scoped groups, never concurrently with them', async () => {
	const dir = setupMonorepo();
	const config = await readConfig({ cwd: dir });

	const error = await runGates({
		cwd: dir,
		config,
		packages: ['api', 'web'],
		includeRoot: true,
	});

	expect(error).toBe(undefined);

	const lines = readGateLog({ dir });
	const firstRootIndex = lines.findIndex((line) => line.startsWith('root '));
	const lastScopedIndex = Math.max(...lines.map((line, index) => (line.startsWith('root ') ? -1 : index)));

	// root group ran
	expect(firstRootIndex > -1).toBeTruthy();
	// scoped groups ran
	expect(lastScopedIndex > -1).toBeTruthy();
	// every root command after every scoped command (root starts at
	// ${firstRootIndex}, scoped ends at ${lastScopedIndex}):\n${lines.join('\n')}
	expect(firstRootIndex > lastScopedIndex).toBeTruthy();
});
