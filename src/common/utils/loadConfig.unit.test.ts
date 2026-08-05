import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '@/common/utils/loadConfig';

const setupRepo = ({ raw }: { raw?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-loadconfig-'));

	if (raw !== undefined) {
		writeFileSync(join(cwd, 'lightsout.config.json'), raw);
	}

	return { cwd, configPath: join(cwd, 'lightsout.config.json') };
};

test('loadConfig: a valid config at the repo root parses into the typed shape', async () => {
	const { cwd } = setupRepo({
		raw: JSON.stringify({
			harness: 'codex',
			scripts: { check: 'tsc --noEmit', testUnit: 'node --test', testCoverage: false },
			generated: ['plugin/dist/'],
		}),
	});

	const config = await loadConfig({ cwd });

	assert.deepEqual(config.scripts, { check: 'tsc --noEmit', testUnit: 'node --test', testCoverage: false });
	assert.equal(config.harness, 'codex');
	assert.deepEqual(config.generated, ['plugin/dist/']);
});

test('loadConfig: a missing config is a hard error naming the exact path it looked at', async () => {
	const { cwd, configPath } = setupRepo();

	await assert.rejects(
		loadConfig({ cwd }),
		(error: unknown) => error instanceof Error && error.message === `lightsout.config.json not found at ${configPath}`,
	);
});

test('loadConfig: malformed JSON surfaces as a syntax error, distinct from a missing file', async () => {
	const { cwd } = setupRepo({ raw: '{ "scripts": ' });

	await assert.rejects(loadConfig({ cwd }), SyntaxError);
});

test('loadConfig: a config that parses as JSON but violates the schema fails validation', async () => {
	const { cwd } = setupRepo({ raw: JSON.stringify({ harness: 'codex' }) });

	await assert.rejects(
		loadConfig({ cwd }),
		(error: unknown) => error instanceof Error && !/not found/.test(error.message) && /scripts/.test(error.message),
	);
});
