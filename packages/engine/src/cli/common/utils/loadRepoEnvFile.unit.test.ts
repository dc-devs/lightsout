import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, jest, test } from '@jest/globals';
import { loadRepoEnvFile } from '#src/cli/common/utils/loadRepoEnvFile.ts';

const trackerKey = 'LIGHTSOUT_TEST_TRACKER_KEY';

const setupRepo = ({ contents }: { contents?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-env-file-'));

	if (contents !== undefined) {
		writeFileSync(join(cwd, '.env'), contents);
	}

	return { cwd };
};

afterEach(() => {
	delete process.env[trackerKey];
	jest.restoreAllMocks();
});

test('loadRepoEnvFile: a key in .env reaches the environment, so a command need not be prefixed with it', () => {
	const { cwd } = setupRepo({ contents: `${trackerKey}=from_file\n` });

	loadRepoEnvFile({ cwd });

	expect(process.env[trackerKey]).toBe('from_file');
});

test('loadRepoEnvFile: a variable already exported wins over the file, so a CI secret is never overwritten', () => {
	const { cwd } = setupRepo({ contents: `${trackerKey}=from_file\n` });
	process.env[trackerKey] = 'from_environment';

	loadRepoEnvFile({ cwd });

	expect(process.env[trackerKey]).toBe('from_environment');
});

test('loadRepoEnvFile: a repository with no .env is silent, because most have none and every command must still run', () => {
	const { cwd } = setupRepo();
	const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

	loadRepoEnvFile({ cwd });

	expect(errors).not.toHaveBeenCalled();
	expect(process.env[trackerKey]).toBe(undefined);
});

test('loadRepoEnvFile: a .env that cannot be read is reported and the command carries on, rather than failing the run', () => {
	const { cwd } = setupRepo();
	mkdirSync(join(cwd, '.env'));
	const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

	expect(() => loadRepoEnvFile({ cwd })).not.toThrow();
	expect(errors).toHaveBeenCalledWith(expect.stringContaining(join(cwd, '.env')));
});

test('loadRepoEnvFile: comments and quoted values are read the way Node reads them', () => {
	const { cwd } = setupRepo({ contents: `# the tracker key\n${trackerKey}="two words"\n` });

	loadRepoEnvFile({ cwd });

	expect(process.env[trackerKey]).toBe('two words');
});
