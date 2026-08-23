import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';

const setupRepo = ({ raw }: { raw?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-readconfig-'));

	if (raw !== undefined) {
		writeFileSync(join(cwd, 'lightsout.config.json'), raw);
	}

	return { cwd, configPath: join(cwd, 'lightsout.config.json') };
};

test('readConfig: a valid config at the repo root parses into the typed shape', async () => {
	const { cwd } = setupRepo({
		raw: JSON.stringify({
			harness: 'codex',
			gates: { check: 'tsc --noEmit', test: 'node --test', 'test-coverage': false },
			generated: ['plugin/dist/'],
		}),
	});

	const config = await readConfig({ cwd });

	expect(config.gates).toStrictEqual({ check: 'tsc --noEmit', test: 'node --test', 'test-coverage': false });
	expect(config.harness).toBe('codex');
	expect(config.generated).toStrictEqual(['plugin/dist/']);
});

test('readConfig: a missing config is a hard error naming the exact path it looked at', async () => {
	const { cwd, configPath } = setupRepo();

	const error = await getRejectionError({ promise: readConfig({ cwd }) });

	expect(error.message).toBe(`lightsout.config.json not found at ${configPath}`);
});

test('readConfig: malformed JSON surfaces as a syntax error, distinct from a missing file', async () => {
	const { cwd } = setupRepo({ raw: '{ "gates": ' });

	await expect(readConfig({ cwd })).rejects.toThrow(SyntaxError);
});

test('readConfig: a config that parses as JSON but violates the schema fails validation', async () => {
	const { cwd } = setupRepo({ raw: JSON.stringify({ harness: 'codex' }) });

	const error = await getRejectionError({ promise: readConfig({ cwd }) });

	// a malformed file is a distinct failure from an absent one
	expect(error.message).not.toMatch(/not found/);
	expect(error.message).toMatch(/gates/);
});

test('readOptionalConfig: no config at all is the absence a command may run through', async () => {
	const { cwd } = setupRepo();

	await expect(readOptionalConfig({ cwd })).resolves.toBeUndefined();
});

test('readOptionalConfig: a config that is present and valid is returned, not defaulted away', async () => {
	const { cwd } = setupRepo({
		raw: JSON.stringify({ gates: { check: 'tsc --noEmit', test: 'node --test', 'test-coverage': false }, generated: ['plugin/dist/'] }),
	});

	const config = await readOptionalConfig({ cwd });

	expect(config?.generated).toStrictEqual(['plugin/dist/']);
});

test('readOptionalConfig: an illegal scoped-gate key throws rather than falling back to defaults', async () => {
	// The measured case: `format` is not a legal package-gates key, doctor
	// refuses it by name, and every other command used to read defaults instead
	// — which silently dropped `generated` and reported findings on generated
	// files as if they were source.
	const { cwd } = setupRepo({
		raw: JSON.stringify({
			gates: { check: 'tsc --noEmit', test: 'node --test', 'test-coverage': false },
			'package-gates': { check: 'pnpm --filter {package} run check', test: 'pnpm --filter {package} run test:unit', format: 'pnpm format' },
		}),
	});

	const error = await getRejectionError({ promise: readOptionalConfig({ cwd }) });

	expect(error.message).toMatch(/format/);
});

test('readOptionalConfig: a config that is not JSON at all throws rather than defaulting', async () => {
	const { cwd } = setupRepo({ raw: '{ not json' });

	const error = await getRejectionError({ promise: readOptionalConfig({ cwd }) });

	expect(error).toBeDefined();
});
