import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { resolveConfigAndDriver } from '@/cli/common/utils/resolveConfigAndDriver';

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

	expect(config).toBe(undefined);
	expect(driver.name).toBe('claude-code');
});

test('resolveConfigAndDriver: global harness and model land in the effective config and the driver', async () => {
	const { cwd } = setupConsumerDir({ config: { harness: 'codex', model: 'gpt-5.2', gates: { check: 'c', test: 't', 'test-coverage': false } } });

	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'plan' });

	expect(driver.name).toBe('codex');
	expect(config).toStrictEqual({ harness: 'codex', model: 'gpt-5.2', effort: undefined, gates: { check: 'c', test: 't', 'test-coverage': false } });
});

test('resolveConfigAndDriver: a per-command harness override drops the global model from the effective config (decision 7)', async () => {
	const { cwd } = setupConsumerDir({
		config: { model: 'opus', commands: { improve: { harness: 'codex' } }, gates: { check: 'c', test: 't', 'test-coverage': false } },
	});

	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'improve' });

	expect(driver.name).toBe('codex');
	expect(config).toStrictEqual({
		harness: 'codex',
		model: undefined,
		effort: undefined,
		commands: { improve: { harness: 'codex' } },
		gates: { check: 'c', test: 't', 'test-coverage': false },
	});
});

test('resolveConfigAndDriver: a global effort lands in the effective config', async () => {
	const { cwd } = setupConsumerDir({ config: { effort: 'high', gates: { check: 'c', test: 't', 'test-coverage': false } } });

	const { config } = await resolveConfigAndDriver({ cwd, command: 'plan' });

	expect(config).toStrictEqual({ harness: 'claude-code', model: undefined, effort: 'high', gates: { check: 'c', test: 't', 'test-coverage': false } });
});

test('resolveConfigAndDriver: a per-command effort overrides the global in the effective config', async () => {
	const { cwd } = setupConsumerDir({
		config: { effort: 'low', commands: { plan: { effort: 'max' } }, gates: { check: 'c', test: 't', 'test-coverage': false } },
	});

	const { config } = await resolveConfigAndDriver({ cwd, command: 'plan' });

	expect(config).toStrictEqual({
		harness: 'claude-code',
		model: undefined,
		effort: 'max',
		commands: { plan: { effort: 'max' } },
		gates: { check: 'c', test: 't', 'test-coverage': false },
	});
});

test('resolveConfigAndDriver: a present-but-invalid config (typoed commands key) is a hard error', async () => {
	const { cwd } = setupConsumerDir({ config: { commands: { implment: {} }, gates: { check: 'c', test: 't', 'test-coverage': false } } });

	// continuing would silently discard every setting in the file and run with
	// defaults (decision 26)
	expect(resolveConfigAndDriver({ cwd, command: 'implement' })).rejects.toThrow();
});

test('resolveConfigAndDriver: a stale top-level driver key rejects with a message naming harness', async () => {
	const { cwd } = setupConsumerDir({ config: { driver: 'codex', gates: { check: 'c', test: 't', 'test-coverage': false } } });

	await expect(resolveConfigAndDriver({ cwd, command: 'plan' })).rejects.toThrow(/renamed to `harness`/);
});
