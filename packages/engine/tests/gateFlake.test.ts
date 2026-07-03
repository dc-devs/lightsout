import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/index';
import { runGates } from '../src/runGates';
import { setupConsumerRepo } from './helpers/setupConsumerRepo';
import { setupMonorepo } from './helpers/setupMonorepo';
import { readGateLog } from './helpers/readGateLog';

/** Fails on first execution, passes on the second — a one-shot flake. */
const flakyCommand = `node -e "const fs=require('fs'); if (fs.existsSync('flaked')) process.exit(0); fs.writeFileSync('flaked',''); process.exit(1)"`;

test('a red gate is re-run once — a one-shot flake does not fail the gate set', async () => {
	const dir = setupConsumerRepo({ scripts: { testUnit: flakyCommand } });
	const config = await loadConfig({ cwd: dir });

	const error = await runGates({ cwd: dir, config });

	assert.equal(error, undefined, 'flake absorbed by the mechanical re-run');
});

test('two consecutive reds are a genuine red, both executions in the command log', async () => {
	const dir = setupConsumerRepo({ scripts: { testUnit: 'node -e "process.exit(1)"' } });
	const config = await loadConfig({ cwd: dir });

	const error = await runGates({ cwd: dir, config, runId: 'r1', step: 'verify' });

	assert.match(error ?? '', /test-unit failed/);

	const log = readFileSync(join(dir, '.lightsout', 'runs', 'r1', 'commands.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.filter((record) => record.kind === 'testUnit');

	assert.equal(log.length, 2, 'both executions logged');
	assert.equal(log[0].rerun, undefined);
	assert.equal(log[1].rerun, true);
});

test('root group runs after the scoped groups, never concurrently with them', async () => {
	const dir = setupMonorepo();
	const config = await loadConfig({ cwd: dir });

	const error = await runGates({
		cwd: dir,
		config,
		packages: ['api', 'web'],
		includeRoot: true,
	});

	assert.equal(error, undefined);

	const lines = readGateLog({ dir });
	const firstRootIndex = lines.findIndex((line) => line.startsWith('root '));
	const lastScopedIndex = Math.max(...lines.map((line, index) => (line.startsWith('root ') ? -1 : index)));

	assert.ok(firstRootIndex > -1, 'root group ran');
	assert.ok(lastScopedIndex > -1, 'scoped groups ran');
	assert.ok(firstRootIndex > lastScopedIndex, `every root command after every scoped command (root starts at ${firstRootIndex}, scoped ends at ${lastScopedIndex}):\n${lines.join('\n')}`);
});
