import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runCli } from '#tests/helpers/runCli.ts';

// A whole standards pack, loaded and executed by the built CLI as a real
// subprocess. This is the only place the engine's import of a pack's own
// check.ts runs under real Node type stripping — in-process suites transpile
// through ts-jest, which would answer a different question.

/**
 * A rule's check, written the way a pack author writes one: annotations and
 * an interface that must erase at run time, and no import of anything outside
 * its own folder.
 */
const checkSource = `interface RawFinding {
	siteKey: string;
	files: Array<{ path: string }>;
	detail: string;
}

const isBanned = (path: string): boolean => path.endsWith('banned.ts');

export const check = {
	inputKind: 'file-list' as const,
	run: ({ input }: { input: { files: string[] } }): RawFinding[] =>
		input.files.filter(isBanned).map((path) => ({ siteKey: \`no-banned-file:\${path}\`, files: [{ path }], detail: 'a file the rule bans' })),
};
`;

const ruleMarkdown = `---
summary: a source file may not be named banned.ts
checked: true
severity: blocking
---

A file named banned.ts is the example this pack exists to refuse.
`;

/**
 * A one-rule pack on disk. `passFiles` is what the check must accept — set it
 * to the banned name to build the pack whose check cries wolf.
 */
const setupPack = async ({ passFiles = ['allowed.ts'] }: { passFiles?: string[] } = {}) => {
	const packPath = await mkdtemp(join(tmpdir(), 'lightsout-standards-pack-'));
	const rulePath = 'code/demo/01-no-banned-file';
	const files: Record<string, string> = {
		'lightsout-standards.json': '{ "name": "demo-standards", "formatVersion": 1 }\n',
		// A standalone pack declares its own module format, so its checks load
		// as ES modules wherever it is unpacked.
		'package.json': '{ "type": "module" }\n',
		'code/demo/document.md': '# Demo\n\nThe document the rule argues under.\n',
		[`${rulePath}/rule.md`]: ruleMarkdown,
		[`${rulePath}/check.ts`]: checkSource,
		[`${rulePath}/fixtures/fail/src/banned.ts`]: 'export const value = 1;\n',
	};

	for (const name of passFiles) {
		files[`${rulePath}/fixtures/pass/src/${name}`] = 'export const value = 1;\n';
	}

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(packPath, path);

		await mkdir(dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, content, 'utf8');
	}

	return { packPath };
};

test('cli: standards-validate loads a pack, runs its check against its fixtures, and exits 0', async () => {
	const { packPath } = await setupPack();

	const { stdout, stderr, code } = await runCli({ args: ['standards-validate', '--pack', packPath] });

	// the check ran from a .ts file the engine imported directly — no build step
	expect(stdout).toContain('demo-standards — 1 checked rule(s) validated, 0 judgment-only rule(s)');
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: standards-validate names the rule whose check flags its own pass fixture and exits 1', async () => {
	const { packPath } = await setupPack({ passFiles: ['banned.ts'] });

	const { stdout, stderr, code } = await runCli({ args: ['standards-validate', '--pack', packPath] });

	expect(stdout).toContain('no-banned-file: the pass fixture produced 1 finding(s)');
	expect(stdout).toContain('1 problem(s) across 1 checked rule(s)');
	expect(stderr).toBe('');
	expect(code).toBe(1);
});

test('cli: standards-validate reports a pack it cannot load and exits 1', async () => {
	const packPath = await mkdtemp(join(tmpdir(), 'lightsout-standards-empty-'));

	const { stdout, stderr, code } = await runCli({ args: ['standards-validate', '--pack', packPath] });

	expect(stdout).toBe('');
	expect(stderr).toMatch(/standards pack root file not found/);
	expect(code).toBe(1);
});
