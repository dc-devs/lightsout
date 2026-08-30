import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { selectCollectedFiles } from '#src/coverage/selectCollectedFiles/selectCollectedFiles.ts';

// The reader genuinely requires the consumer's Jest config, so every case
// plants a real one on disk rather than stubbing the read.
const setupRepo = ({ files }: { files: Record<string, string> }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-collected-'));

	for (const [name, content] of Object.entries(files)) {
		mkdirSync(join(cwd, dirname(name)), { recursive: true });
		writeFileSync(join(cwd, name), content);
	}

	return cwd;
};

const jestConfig = ({ settings }: { settings: Record<string, unknown> }) => `module.exports = ${JSON.stringify(settings)};\n`;

const commandConfig = ({ command }: { command: string }): LightsoutConfig => ({ gates: { check: 'true', test: 'true', 'test-coverage': command } });

/** Root mode, with the coverage command naming its own config — the shape every package in this workspace uses. */
const rootConfig = commandConfig({ command: 'jest -c jest.config.cjs --coverage' });

const monorepoConfig: LightsoutConfig = {
	gates: { check: 'true', test: 'true', 'test-coverage': false },
	'package-gates': { check: 'true {package}', test: 'true {package}', 'test-coverage': 'pnpm --filter {package} run test:coverage' },
};

const source = 'export const value = 1;\n';

/** Plant a root jest.config.cjs holding `settings` over `files`, then split them. */
const splitRoot = async ({ settings, files }: { settings: Record<string, unknown>; files: string[] }) => {
	const cwd = setupRepo({ files: { 'jest.config.cjs': jestConfig({ settings }), ...Object.fromEntries(files.map((file) => [file, source])) } });

	return selectCollectedFiles({ cwd, config: rootConfig, files });
};

test('selectCollectedFiles: a negation glob excludes a fixture file and leaves its non-fixture sibling collected', async () => {
	const { collected, excluded } = await splitRoot({
		settings: { collectCoverageFrom: ['**/*.ts', '!**/*.unit.test.ts', '!**/fixtures/**'] },
		files: ['code/rule/fixtures/bad.ts', 'code/rule/check.ts'],
	});

	expect(excluded).toStrictEqual(['code/rule/fixtures/bad.ts']);
	expect(collected).toStrictEqual(['code/rule/check.ts']);
});

test('selectCollectedFiles: omission excludes too — a .tsx and a file outside the positives match no glob at all', async () => {
	const { collected, excluded } = await splitRoot({
		settings: { collectCoverageFrom: ['src/**/*.ts'] },
		files: ['src/App.tsx', 'tooling/helper.ts', 'src/a.ts'],
	});

	expect(excluded).toStrictEqual(['src/App.tsx', 'tooling/helper.ts']);
	expect(collected).toStrictEqual(['src/a.ts']);
});

test('selectCollectedFiles: a declaration-file negation excludes the .d.ts and nothing else', async () => {
	const { collected, excluded } = await splitRoot({
		settings: { collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'] },
		files: ['src/markdown.d.ts', 'src/a.ts'],
	});

	expect(excluded).toStrictEqual(['src/markdown.d.ts']);
	expect(collected).toStrictEqual(['src/a.ts']);
});

test('selectCollectedFiles: rootDir is what the globs are written against, so a file outside it is uncollected', async () => {
	const { collected, excluded } = await splitRoot({
		settings: { rootDir: './app', collectCoverageFrom: ['src/**/*.ts'] },
		files: ['app/src/a.ts', 'other/src/b.ts'],
	});

	// under the repo root this glob would mean the repo's own src/ and match neither
	expect(collected).toStrictEqual(['app/src/a.ts']);
	expect(excluded).toStrictEqual(['other/src/b.ts']);
});

test('selectCollectedFiles: coveragePathIgnorePatterns excludes a folder the positives do match', async () => {
	const { collected, excluded } = await splitRoot({
		settings: { collectCoverageFrom: ['src/**/*.ts'], coveragePathIgnorePatterns: ['/src/generated/'] },
		files: ['src/generated/model.ts', 'src/a.ts'],
	});

	expect(excluded).toStrictEqual(['src/generated/model.ts']);
	expect(collected).toStrictEqual(['src/a.ts']);
});

test('selectCollectedFiles: a <rootDir> ignore pattern is substituted, and an absent collectCoverageFrom collects everything else', async () => {
	const { collected, excluded } = await splitRoot({
		settings: { coveragePathIgnorePatterns: ['<rootDir>/src/vendor/'] },
		files: ['src/vendor/lib.ts', 'src/a.ts'],
	});

	// left literal the pattern is a valid expression that can never match an
	// absolute path, so the repo's own exclusion would silently do nothing
	expect(excluded).toStrictEqual(['src/vendor/lib.ts']);
	expect(collected).toStrictEqual(['src/a.ts']);
});

test('selectCollectedFiles: an ignore pattern that is not a valid regular expression excludes nothing', async () => {
	const { collected } = await splitRoot({
		settings: { collectCoverageFrom: ['src/**/*.ts'], coveragePathIgnorePatterns: ['(unclosed'] },
		files: ['src/a.ts'],
	});

	expect(collected).toStrictEqual(['src/a.ts']);
});

test('selectCollectedFiles: a config the engine cannot evaluate leaves every file collected', async () => {
	const cwd = setupRepo({
		files: {
			// a real jest.config.ts imports its preset — unresolvable here, so the require throws
			'jest.config.ts': [
				"import { createDefaultPreset } from 'ts-jest';",
				'',
				"export default { ...createDefaultPreset(), collectCoverageFrom: ['src/**/*.ts'] };",
			].join('\n'),
			'other/a.ts': source,
		},
	});
	const config = commandConfig({ command: 'jest -c jest.config.ts --coverage' });

	const { collected } = await selectCollectedFiles({ cwd, config, files: ['other/a.ts'] });

	expect(collected).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: no configuration at all leaves every file collected', async () => {
	const cwd = setupRepo({ files: { 'package.json': JSON.stringify({ name: 'consumer', scripts: {} }), 'src/a.ts': source } });
	const config = commandConfig({ command: 'jest --coverage' });

	const { collected, excluded } = await selectCollectedFiles({ cwd, config, files: ['src/a.ts'] });

	expect(collected).toStrictEqual(['src/a.ts']);
	expect(excluded).toStrictEqual([]);
});

test('selectCollectedFiles: a package’s -c argument decides which of its two configs is read', async () => {
	const cwd = setupRepo({
		files: {
			'packages/api/package.json': JSON.stringify({ name: '@acme/api', scripts: { 'test:coverage': 'jest -c jest.config.cjs --coverage' } }),
			'packages/api/jest.config.cjs': jestConfig({ settings: { collectCoverageFrom: ['src/**/*.ts', '!**/fixtures/**'] } }),
			'packages/api/jest.e2e.config.cjs': jestConfig({ settings: { collectCoverageFrom: ['**/*.ts'] } }),
			'packages/api/src/fixtures/sample.ts': source,
			'packages/api/src/a.ts': source,
		},
	});

	const { collected, excluded } = await selectCollectedFiles({
		cwd,
		config: monorepoConfig,
		files: ['packages/api/src/fixtures/sample.ts', 'packages/api/src/a.ts'],
	});

	// the e2e config collects everything — reading it would leave the fixture collected
	expect(excluded).toStrictEqual(['packages/api/src/fixtures/sample.ts']);
	expect(collected).toStrictEqual(['packages/api/src/a.ts']);
});

test('selectCollectedFiles: a file no coverage scope measures counts as collected', async () => {
	const cwd = setupRepo({
		files: { 'jest.config.cjs': jestConfig({ settings: { collectCoverageFrom: ['src/**/*.ts'] } }), 'packages/api/src/a.ts': source },
	});

	// root mode owns nothing under the packages dir, so the exclusion never applies
	const { collected } = await selectCollectedFiles({ cwd, config: rootConfig, files: ['packages/api/src/a.ts'] });

	expect(collected).toStrictEqual(['packages/api/src/a.ts']);
});

test('selectCollectedFiles: Jest’s default node_modules exclusion still applies when the key is absent', async () => {
	const { collected, excluded } = await splitRoot({
		settings: { collectCoverageFrom: ['**/*.ts'] },
		files: ['node_modules/dep/index.ts', 'src/a.ts'],
	});

	// this is what keeps a package collecting **/*.ts from measuring its own dependency tree
	expect(excluded).toStrictEqual(['node_modules/dep/index.ts']);
	expect(collected).toStrictEqual(['src/a.ts']);
});

test('selectCollectedFiles: a literal glob matches that path and no other', async () => {
	const { collected, excluded } = await splitRoot({ settings: { collectCoverageFrom: ['src/a.ts'] }, files: ['src/a.ts', 'src/b.ts'] });

	expect(collected).toStrictEqual(['src/a.ts']);
	expect(excluded).toStrictEqual(['src/b.ts']);
});

test('selectCollectedFiles: `?` stands for exactly one character', async () => {
	const { collected, excluded } = await splitRoot({ settings: { collectCoverageFrom: ['src/?.ts'] }, files: ['src/a.ts', 'src/ab.ts'] });

	expect(collected).toStrictEqual(['src/a.ts']);
	expect(excluded).toStrictEqual(['src/ab.ts']);
});

test('selectCollectedFiles: `*` never crosses a path separator', async () => {
	const { collected, excluded } = await splitRoot({ settings: { collectCoverageFrom: ['src/*.ts'] }, files: ['src/a.ts', 'src/deep/a.ts'] });

	expect(collected).toStrictEqual(['src/a.ts']);
	expect(excluded).toStrictEqual(['src/deep/a.ts']);
});

test('selectCollectedFiles: a leading `**` spans no segments as readily as several', async () => {
	const { collected, excluded } = await splitRoot({ settings: { collectCoverageFrom: ['**/*.ts'] }, files: ['a.ts', 'deep/nested/a.ts'] });

	expect(collected).toStrictEqual(['a.ts', 'deep/nested/a.ts']);
	expect(excluded).toStrictEqual([]);
});

test('selectCollectedFiles: a trailing `**` takes everything below it', async () => {
	const { collected, excluded } = await splitRoot({
		settings: { collectCoverageFrom: ['src/**'] },
		files: ['src/a.ts', 'src/deep/a.ts', 'other/a.ts'],
	});

	expect(collected).toStrictEqual(['src/a.ts', 'src/deep/a.ts']);
	expect(excluded).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: a `{a,b}` alternation matches either branch and nothing else', async () => {
	const { collected, excluded } = await splitRoot({
		settings: { collectCoverageFrom: ['src/**/*.{ts,tsx}'] },
		files: ['src/a.ts', 'src/a.tsx', 'src/a.js'],
	});

	expect(collected).toStrictEqual(['src/a.ts', 'src/a.tsx']);
	expect(excluded).toStrictEqual(['src/a.js']);
});

test('selectCollectedFiles: a `<rootDir>/` prefix behaves exactly as the bare glob does', async () => {
	const { collected, excluded } = await splitRoot({ settings: { collectCoverageFrom: ['<rootDir>/src/**/*.ts'] }, files: ['src/a.ts', 'other/a.ts'] });

	// left literal, `<` and `>` would match as ordinary characters and the whole
	// scope would read as uncollected — the one way this could remove teeth
	expect(collected).toStrictEqual(['src/a.ts']);
	expect(excluded).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: a `./` prefix behaves exactly as the bare glob does', async () => {
	const { collected, excluded } = await splitRoot({ settings: { collectCoverageFrom: ['./src/**/*.ts'] }, files: ['src/a.ts', 'other/a.ts'] });

	expect(collected).toStrictEqual(['src/a.ts']);
	expect(excluded).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: a character class is syntax the matcher does not implement, so the file stays collected', async () => {
	const { collected } = await splitRoot({ settings: { collectCoverageFrom: ['src/**/*.[jt]s'] }, files: ['other/a.ts'] });

	expect(collected).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: an extglob leaves the file collected rather than guessed at', async () => {
	const { collected } = await splitRoot({ settings: { collectCoverageFrom: ['src/+(a|b).ts'] }, files: ['other/a.ts'] });

	expect(collected).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: a backslash escape leaves the file collected rather than guessed at', async () => {
	const { collected } = await splitRoot({ settings: { collectCoverageFrom: ['src/\\*.ts'] }, files: ['other/a.ts'] });

	expect(collected).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: nested braces leave the file collected rather than guessed at', async () => {
	const { collected } = await splitRoot({ settings: { collectCoverageFrom: ['src/{a,{b,c}}.ts'] }, files: ['other/a.ts'] });

	expect(collected).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: unbalanced braces leave the file collected instead of throwing', async () => {
	const { collected } = await splitRoot({ settings: { collectCoverageFrom: ['src/{a,b.ts', 'src/a}.ts'] }, files: ['other/a.ts'] });

	// a throw here would propagate into both the gate and the write-tests step
	expect(collected).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: a config exporting a function is not run, and its files stay collected', async () => {
	const cwd = setupRepo({ files: { 'jest.config.cjs': "module.exports = () => ({ collectCoverageFrom: ['src/**/*.ts'] });\n", 'other/a.ts': source } });

	const { collected } = await selectCollectedFiles({ cwd, config: rootConfig, files: ['other/a.ts'] });

	expect(collected).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: a config exporting a promise is not awaited, and its files stay collected', async () => {
	const cwd = setupRepo({
		files: { 'jest.config.cjs': "module.exports = Promise.resolve({ collectCoverageFrom: ['src/**/*.ts'] });\n", 'other/a.ts': source },
	});

	const { collected } = await selectCollectedFiles({ cwd, config: rootConfig, files: ['other/a.ts'] });

	expect(collected).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: a config that is not a settings object at all leaves its files collected', async () => {
	const cwd = setupRepo({ files: { 'jest.config.cjs': 'module.exports = [];\n', 'other/a.ts': source } });

	const { collected } = await selectCollectedFiles({ cwd, config: rootConfig, files: ['other/a.ts'] });

	expect(collected).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: a collectCoverageFrom whose entries are not all strings is read as absent', async () => {
	const { collected } = await splitRoot({ settings: { collectCoverageFrom: ['src/**/*.ts', 3] }, files: ['other/a.ts'] });

	expect(collected).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: a -c naming a file that is not there answers undefined rather than falling back', async () => {
	const cwd = setupRepo({
		files: { 'jest.config.cjs': jestConfig({ settings: { collectCoverageFrom: ['src/**/*.ts'] } }), 'other/a.ts': source },
	});
	const config = commandConfig({ command: 'jest -c jest.missing.cjs --coverage' });

	// falling back to the config that IS there would read a suite the command never runs
	const { collected } = await selectCollectedFiles({ cwd, config, files: ['other/a.ts'] });

	expect(collected).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: with no -c the config file at the scope root is read, quoted and `--config=` spellings included', async () => {
	const cwd = setupRepo({ files: { 'jest.config.cjs': jestConfig({ settings: { collectCoverageFrom: ['src/**/*.ts'] } }), 'other/a.ts': source } });

	expect((await selectCollectedFiles({ cwd, config: commandConfig({ command: 'jest --coverage' }), files: ['other/a.ts'] })).excluded).toStrictEqual([
		'other/a.ts',
	]);
	expect(
		(await selectCollectedFiles({ cwd, config: commandConfig({ command: 'jest --config=jest.config.cjs' }), files: ['other/a.ts'] })).excluded,
	).toStrictEqual(['other/a.ts']);
	expect((await selectCollectedFiles({ cwd, config: commandConfig({ command: 'jest -c "jest.config.cjs"' }), files: ['other/a.ts'] })).excluded).toStrictEqual([
		'other/a.ts',
	]);
});

test('selectCollectedFiles: a package.json `jest` key is the configuration when no config file exists', async () => {
	const cwd = setupRepo({
		files: { 'package.json': JSON.stringify({ name: 'consumer', jest: { collectCoverageFrom: ['src/**/*.ts'] } }), 'other/a.ts': source },
	});
	const config = commandConfig({ command: 'npm run coverage' });

	const { excluded } = await selectCollectedFiles({ cwd, config, files: ['other/a.ts'] });

	expect(excluded).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: a script body the engine cannot read costs the lookup, never the whole answer', async () => {
	const cwd = setupRepo({ files: { 'jest.config.cjs': jestConfig({ settings: { collectCoverageFrom: ['src/**/*.ts'] } }), 'other/a.ts': source } });
	const config = commandConfig({ command: 'npm run coverage' });

	// the command names a script this repo has no manifest to declare, so the
	// config file at the scope root is what answers
	const { excluded } = await selectCollectedFiles({ cwd, config, files: ['other/a.ts'] });

	expect(excluded).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: a manifest that is not JSON leaves every file collected', async () => {
	const cwd = setupRepo({ files: { 'package.json': '{ not json', 'other/a.ts': source } });
	const config = commandConfig({ command: 'npm run coverage' });

	// the manifest cannot name the script, the repo ships no config file, and no
	// `jest` key can be read — nothing is known, so nothing is exempted
	const { collected } = await selectCollectedFiles({ cwd, config, files: ['other/a.ts'] });

	expect(collected).toStrictEqual(['other/a.ts']);
});

test('selectCollectedFiles: a manifest that is not an object leaves every file collected', async () => {
	const cwd = setupRepo({ files: { 'package.json': '"a string"', 'other/a.ts': source } });
	const config = commandConfig({ command: 'npm run coverage' });

	const { collected } = await selectCollectedFiles({ cwd, config, files: ['other/a.ts'] });

	expect(collected).toStrictEqual(['other/a.ts']);
});
