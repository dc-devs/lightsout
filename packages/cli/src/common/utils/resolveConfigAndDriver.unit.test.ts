import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveConfigAndDriver } from './resolveConfigAndDriver';

const setupConsumerDir = ({ config }: { config?: Record<string, unknown> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-cli-resolve-'));

	if (config) {
		writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify(config));
	}

	return { cwd };
};

test('resolveConfigAndDriver: only a genuinely absent config file is non-fatal — claude-code driver, no config', async () => {
	const { cwd } = setupConsumerDir();

	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'improve' });

	assert.equal(config, undefined);
	assert.equal(driver.name, 'claude-code');
});

test('resolveConfigAndDriver: global harness and model land in the effective config and the driver', async () => {
	const { cwd } = setupConsumerDir({ config: { harness: 'codex', model: 'gpt-5.2', scripts: { check: 'c', testUnit: 't', testCoverage: false } } });

	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'plan' });

	assert.equal(driver.name, 'codex');
	assert.deepEqual(config, { harness: 'codex', model: 'gpt-5.2', effort: undefined, scripts: { check: 'c', testUnit: 't', testCoverage: false } });
});

test('resolveConfigAndDriver: a per-command harness override drops the global model from the effective config (decision 7)', async () => {
	const { cwd } = setupConsumerDir({ config: { model: 'opus', commands: { improve: { harness: 'codex' } }, scripts: { check: 'c', testUnit: 't', testCoverage: false } } });

	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'improve' });

	assert.equal(driver.name, 'codex');
	assert.deepEqual(config, {
		harness: 'codex',
		model: undefined,
		effort: undefined,
		commands: { improve: { harness: 'codex' } },
		scripts: { check: 'c', testUnit: 't', testCoverage: false },
	});
});

test('resolveConfigAndDriver: a global effort lands in the effective config', async () => {
	const { cwd } = setupConsumerDir({ config: { effort: 'high', scripts: { check: 'c', testUnit: 't', testCoverage: false } } });

	const { config } = await resolveConfigAndDriver({ cwd, command: 'plan' });

	assert.deepEqual(config, { harness: 'claude-code', model: undefined, effort: 'high', scripts: { check: 'c', testUnit: 't', testCoverage: false } });
});

test('resolveConfigAndDriver: a per-command effort overrides the global in the effective config', async () => {
	const { cwd } = setupConsumerDir({ config: { effort: 'low', commands: { plan: { effort: 'max' } }, scripts: { check: 'c', testUnit: 't', testCoverage: false } } });

	const { config } = await resolveConfigAndDriver({ cwd, command: 'plan' });

	assert.deepEqual(config, {
		harness: 'claude-code',
		model: undefined,
		effort: 'max',
		commands: { plan: { effort: 'max' } },
		scripts: { check: 'c', testUnit: 't', testCoverage: false },
	});
});

test('resolveConfigAndDriver: a present-but-invalid config (typoed commands key) is a hard error', async () => {
	const { cwd } = setupConsumerDir({ config: { commands: { implment: {} }, scripts: { check: 'c', testUnit: 't', testCoverage: false } } });

	await assert.rejects(
		resolveConfigAndDriver({ cwd, command: 'implement' }),
		'continuing would silently discard every setting in the file and run with defaults (decision 26)',
	);
});

test('resolveConfigAndDriver: a stale top-level driver key rejects with a message naming harness', async () => {
	const { cwd } = setupConsumerDir({ config: { driver: 'codex', scripts: { check: 'c', testUnit: 't', testCoverage: false } } });

	await assert.rejects(resolveConfigAndDriver({ cwd, command: 'plan' }), /renamed to `harness`/);
});
