import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';

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
			gates: { check: 'tsc --noEmit', test: 'node --test', 'test-coverage': false },
			generated: ['plugin/dist/'],
		}),
	});

	const config = await loadConfig({ cwd });

	expect(config.gates).toStrictEqual({ check: 'tsc --noEmit', test: 'node --test', 'test-coverage': false });
	expect(config.harness).toBe('codex');
	expect(config.generated).toStrictEqual(['plugin/dist/']);
});

test('loadConfig: a missing config is a hard error naming the exact path it looked at', async () => {
	const { cwd, configPath } = setupRepo();

	const error = await getRejectionError({ promise: loadConfig({ cwd }) });

	expect(error.message).toBe(`lightsout.config.json not found at ${configPath}`);
});

test('loadConfig: malformed JSON surfaces as a syntax error, distinct from a missing file', async () => {
	const { cwd } = setupRepo({ raw: '{ "gates": ' });

	await expect(loadConfig({ cwd })).rejects.toThrow(SyntaxError);
});

test('loadConfig: a config that parses as JSON but violates the schema fails validation', async () => {
	const { cwd } = setupRepo({ raw: JSON.stringify({ harness: 'codex' }) });

	const error = await getRejectionError({ promise: loadConfig({ cwd }) });

	// a malformed file is a distinct failure from an absent one
	expect(error.message).not.toMatch(/not found/);
	expect(error.message).toMatch(/gates/);
});
