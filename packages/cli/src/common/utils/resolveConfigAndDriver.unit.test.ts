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

test('resolveConfigAndDriver: no config file is non-fatal — claude-code driver, no config', async () => {
	const { cwd } = setupConsumerDir();

	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'improve' });

	assert.equal(config, undefined);
	assert.equal(driver.name, 'claude-code');
});

test('resolveConfigAndDriver: global driver and model land in the effective config and the driver', async () => {
	const { cwd } = setupConsumerDir({ config: { driver: 'codex', model: 'gpt-5.2', scripts: { check: 'c', testUnit: 't', testCoverage: false } } });

	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'plan' });

	assert.equal(driver.name, 'codex');
	assert.deepEqual(config, { driver: 'codex', model: 'gpt-5.2', scripts: { check: 'c', testUnit: 't', testCoverage: false } });
});

test('resolveConfigAndDriver: a per-command driver override drops the global model from the effective config (decision 7)', async () => {
	const { cwd } = setupConsumerDir({ config: { model: 'opus', commands: { improve: { driver: 'codex' } }, scripts: { check: 'c', testUnit: 't', testCoverage: false } } });

	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'improve' });

	assert.equal(driver.name, 'codex');
	assert.deepEqual(config, {
		driver: 'codex',
		model: undefined,
		commands: { improve: { driver: 'codex' } },
		scripts: { check: 'c', testUnit: 't', testCoverage: false },
	});
});

test('resolveConfigAndDriver: an invalid config (typoed commands key) is non-fatal and falls back to claude-code', async () => {
	const { cwd } = setupConsumerDir({ config: { commands: { implment: {} }, scripts: { check: 'c', testUnit: 't', testCoverage: false } } });

	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'implement' });

	assert.equal(config, undefined);
	assert.equal(driver.name, 'claude-code');
});
