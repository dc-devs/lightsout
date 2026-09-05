import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { runCli } from '#tests/helpers/runCli.ts';

// A consumer repo whose authored facts claim one real and one missing path,
// plus one real and one missing script — the mixed case verify-facts must
// warn about while still exiting 0. `factsBody` replaces that authored JSON
// verbatim, which is how the unparsable case is reachable.
const seedVerifyFactsFixture = async ({ factsBody }: { factsBody?: string } = {}) => {
	const cwd = await freshCwd();
	const workspaceDir = join(cwd, '.lightsout', 'plans', 'demo');
	const factsPath = join(workspaceDir, 'facts.json');

	await mkdir(join(cwd, 'src'), { recursive: true });
	await mkdir(workspaceDir, { recursive: true });
	await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc --noEmit' } }), 'utf8');
	await writeFile(join(cwd, 'src', 'real.ts'), 'export const real = true;\n', 'utf8');
	await writeFile(
		factsPath,
		factsBody ??
			JSON.stringify({
				request: 'add a widget',
				areas: [
					{
						area: 'cli',
						affectedPackages: [],
						filesToModify: [
							{ path: 'src/real.ts', role: 'the file that exists' },
							{ path: 'src/missing.ts', role: 'the file that does not' },
						],
						patternsToMirror: [],
						integrationPoints: [],
						scripts: [
							{ key: 'check', command: 'tsc --noEmit' },
							{ key: 'nope', command: 'does not exist' },
						],
						namingConvention: 'camelCase',
					},
				],
			}),
		'utf8',
	);

	return { cwd, factsPath };
};

test('cli: plan verify-facts without an authored facts.json reports the error and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--name', 'demo', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toMatch(/no authored facts for plan demo/);
	expect(code).toBe(1);
});

test('cli: plan verify-facts with an unparsable facts.json reports the error and exits 1', async () => {
	const { cwd } = await seedVerifyFactsFixture({ factsBody: '{"request": 42}' });

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--name', 'demo', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).not.toBe('');
	expect(code).toBe(1);
});

test('cli: plan verify-facts stamps facts.json, warns on misses, and exits 0', async () => {
	const { cwd, factsPath } = await seedVerifyFactsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--name', 'demo', '--cwd', cwd] });

	expect(code).toBe(0);
	expect(stderr).toBe('');
	expect(stdout).toMatch(/plan verify-facts demo — 1 area\(s\), verified /);
	expect(stdout).toMatch(/paths: {3}2 checked · 1 missing/);
	expect(stdout).toMatch(/scripts: 2 checked · 1 missing/);
	expect(stdout).toMatch(/⚠ path not found: src\/missing\.ts/);
	expect(stdout).toMatch(/⚠ script not found: nope/);
	expect(stdout.endsWith(`\nfacts: ${factsPath}\n`)).toBeTruthy();

	const stamped = JSON.parse(await readFile(factsPath, 'utf8'));
	expect(stamped.request).toBe('add a widget');
	expect(stamped.verification).toStrictEqual({
		pathsChecked: 2,
		missingPaths: ['src/missing.ts'],
		scriptsChecked: 2,
		missingScripts: ['nope'],
	});
	expect(Number.isNaN(Date.parse(stamped.verifiedAt))).toBeFalsy();
});

// The engine's snapshot behavior (write-once, freeze-before-facts, missing
// source) is pinned in runPlanVerifyFacts.unit.test.ts; this test pins the CLI
// seam only — `--notes` reaches the engine as a cwd-relative notesFile.
test('cli: plan verify-facts --notes freezes the notes snapshot into the workspace and exits 0', async () => {
	const { cwd } = await seedVerifyFactsFixture();
	await writeFile(join(cwd, 'rough-brainstorm-notes.md'), '# Rough notes\n\nthe idea in plain words\n', 'utf8');

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--name', 'demo', '--notes', 'rough-brainstorm-notes.md', '--cwd', cwd] });

	expect(code).toBe(0);
	expect(stderr).toBe('');
	expect(stdout).toMatch(/plan verify-facts · notes frozen → /);
	const frozen = await readFile(join(cwd, '.lightsout', 'plans', 'demo', 'brainstorm-notes.md'), 'utf8');
	expect(frozen).toBe('# Rough notes\n\nthe idea in plain words\n');
});
