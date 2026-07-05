import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PlanFacts } from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { runPlanExplore } from '../src/index';
import { setupConsumerRepo } from './helpers/setupConsumerRepo';

/** A full ExploreReport (one area) as JSON, with per-test area overrides. */
const exploreReport = (area: Record<string, unknown>) =>
	JSON.stringify({
		areas: [
			{
				area: 'core',
				affectedPackages: [],
				filesToModify: [],
				patternsToMirror: [],
				integrationPoints: [],
				scripts: [],
				namingConvention: 'kebab',
				...area,
			},
		],
	});

/** Explorer stub keyed off the invocation marker, à la helpers/roleOf. */
const exploreDriver = (text: string, opts?: { rateLimited?: boolean }): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		assert.ok(prompt.includes('# Explore input'), 'explorer invocation marker present');

		if (opts?.rateLimited) {
			return { text: '', exitCode: 1, rateLimited: true };
		}

		return { text, exitCode: 0 };
	},
});

test('plan explore: verifies reported paths/scripts and persists facts.json', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));

	const driver = exploreDriver(
		exploreReport({
			filesToModify: [
				{ path: 'src/index.js', role: 'the entry point' },
				{ path: 'src/does-not-exist.ts', role: 'a ghost file' },
			],
			scripts: [
				{ key: 'check', command: 'tsc' },
				{ key: 'lint', command: 'eslint' },
			],
		}),
	);

	const result = await runPlanExplore({ cwd, driver, request: 'add a foo endpoint', name: 'add-foo' });

	assert.equal(result.status, 'complete', result.error);

	const factsPath = join(cwd, '.lightsout', 'plans', 'add-foo', 'facts.json');

	assert.ok(existsSync(factsPath), 'facts.json persisted');

	const facts = PlanFacts.parse(JSON.parse(readFileSync(factsPath, 'utf8')));

	assert.equal(facts.request, 'add a foo endpoint');
	assert.equal(facts.areas.length, 1);
	assert.deepEqual(facts.verification.missingPaths, ['src/does-not-exist.ts'], 'the ghost path is flagged, the real one is not');
	assert.deepEqual(facts.verification.missingScripts, ['lint'], "'check' resolves against package.json; 'lint' does not");
	assert.equal(facts.verification.pathsChecked, 2);
});

test('plan explore: a rate-limited explorer parks the run', async () => {
	const cwd = setupConsumerRepo();
	const result = await runPlanExplore({ cwd, driver: exploreDriver('', { rateLimited: true }), request: 'x', name: 'rl' });

	assert.equal(result.status, 'paused-rate-limit');
});

test('plan explore: all explorers failing the contract returns failed', async () => {
	const cwd = setupConsumerRepo();
	// Never valid ExploreReport JSON, on both the role attempt and the re-emit.
	const driver: Driver = { name: 'stub', invoke: async () => ({ text: 'not json at all', exitCode: 0 }) };
	const result = await runPlanExplore({ cwd, driver, request: 'x', name: 'boom' });

	assert.equal(result.status, 'failed');
});
