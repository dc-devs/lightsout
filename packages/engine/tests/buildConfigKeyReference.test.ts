import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, test } from '@jest/globals';

// The author-time build of the key table inside docs/configuration.md, run as
// the real subprocess `pnpm build:config-reference` runs it.
//
// The table it writes is the first thing a reader of the configuration page
// meets, and its sentences are the same ones the web app's Config page shows —
// so the splice, the blank lines around it, and the `--check` verdict are
// contracts rather than implementation details. `--check` is wired into `pnpm
// check`, which means its exit code is what blocks a merge.
//
// Every case runs in a throwaway repo root: the script resolves the document
// from its own file's location, so a test that ran it in place would rewrite
// this repo's docs/configuration.md and leave the damage behind whenever a test
// threw. The fixture copies scripts/ in and symlinks packages/ back, which is
// what lets the script import the real renderer while writing somewhere
// disposable.
//
// This sits in tests/ rather than beside a source file for the same reason
// buildWorkflowSpecs.test.ts does: its subject is a repo-root script, outside
// src/, naming nothing next to it.

const repoRoot = join(__dirname, '..', '..', '..');
const documentPath = 'docs/configuration.md';
const openMarker = '<!-- generated:config-key-reference -->';
const closeMarker = '<!-- /generated:config-key-reference -->';
const committedDocument = readFileSync(join(repoRoot, documentPath), 'utf8');
const roots: string[] = [];

/** The committed document with everything between its two markers replaced — the one edit every fixture here is a variation of. */
const withRegion = ({ region }: { region: string }) => {
	const before = committedDocument.slice(0, committedDocument.indexOf(openMarker) + openMarker.length);
	const after = committedDocument.slice(committedDocument.indexOf(closeMarker));

	return `${before}${region}${after}`;
};

/**
 * A disposable repo root the script can treat as its own, holding `text` as its
 * configuration document.
 *
 * `packages/` is a symlink rather than a copy: the script imports the renderer's
 * own module file, which reaches the engine's contracts through the `#src/*`
 * alias and its schemas through `zod`, and Node resolves both from the real
 * file's location — so the link costs nothing and stays correct as the engine
 * grows.
 */
const setupConfigKeyReference = ({ text = committedDocument }: { text?: string } = {}) => {
	const root = join(mkdtempSync(join(tmpdir(), 'lightsout-config-reference-')), 'repo');
	const documentFile = join(root, 'docs', 'configuration.md');

	roots.push(root);
	mkdirSync(join(root, 'docs'), { recursive: true });
	cpSync(join(repoRoot, 'scripts'), join(root, 'scripts'), { recursive: true });
	symlinkSync(join(repoRoot, 'packages'), join(root, 'packages'), 'dir');
	writeFileSync(documentFile, text);

	/** The script's own verdict: whether it exited 0, and everything it printed on either stream. */
	const run = ({ args = [] }: { args?: string[] } = {}) => {
		try {
			return {
				ok: true,
				output: execFileSync('node', [join(root, 'scripts', 'buildConfigKeyReference.mjs'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
			};
		} catch (error) {
			const failure = error as { stdout?: string; stderr?: string };

			return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
		}
	};

	/**
	 * Loads the script as a module instead of running it, and reports the exit
	 * code it left behind — the guard at the bottom of the script is what decides
	 * whether an import does any work.
	 */
	const importModule = () => {
		const scriptUrl = JSON.stringify(`file://${join(root, 'scripts', 'buildConfigKeyReference.mjs')}`);
		const child = `await import(${scriptUrl}); process.stdout.write(String(process.exitCode));`;

		return execFileSync('node', ['--input-type=module', '-e', child], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	};

	const readDocument = () => readFileSync(documentFile, 'utf8');

	return { run, readDocument, importModule };
};

afterAll(() => {
	for (const root of roots) {
		rmSync(dirname(root), { recursive: true, force: true });
	}
});

describe('buildConfigKeyReference', () => {
	test('fills an empty region with the table the engine renders, and names the file it wrote', () => {
		const { run, readDocument } = setupConfigKeyReference({ text: withRegion({ region: '\n\n' }) });

		const { ok, output } = run();

		expect({ ok, output }).toStrictEqual({ ok: true, output: 'wrote docs/configuration.md\n' });
		expect(readDocument()).toContain('| Field | Required | What it controls |\n| --- | ---: | --- |\n| `harness` | no |');
	});

	test('surrounds the table with one blank line on each side, so the markers never touch a pipe row', () => {
		const { run, readDocument } = setupConfigKeyReference({ text: withRegion({ region: '\n' }) });

		run();
		const written = readDocument();

		expect(written).toContain(`${openMarker}\n\n| Field |`);
		expect(written).toContain(`|\n\n${closeMarker}`);
	});

	test('rewrites this repo committed document byte for byte, so a rebuild of an up-to-date tree shows no diff', () => {
		const { run, readDocument } = setupConfigKeyReference();

		run();
		const after = readDocument();

		expect(after).toBe(committedDocument);
	});

	test('replaces only what sits between the markers, leaving the hand-written prose around them alone', () => {
		const { run, readDocument } = setupConfigKeyReference({ text: withRegion({ region: '\n\nstale row\n\n' }) });

		run();
		const after = readDocument();

		expect(after).not.toContain('stale row');
		expect(after.slice(0, after.indexOf(openMarker))).toBe(committedDocument.slice(0, committedDocument.indexOf(openMarker)));
		expect(after.slice(after.indexOf(closeMarker))).toBe(committedDocument.slice(committedDocument.indexOf(closeMarker)));
	});

	test('--check passes on the reference this repo has committed, which is what makes the table trustworthy', () => {
		const { run } = setupConfigKeyReference();

		const { ok, output } = run({ args: ['--check'] });

		expect({ ok, output }).toStrictEqual({ ok: true, output: 'docs/configuration.md matches configKeyDescriptions\n' });
	});

	test('--check fails and prints the repair line when the committed table has drifted from the constant', () => {
		const { run } = setupConfigKeyReference({ text: withRegion({ region: '\n\nstale row\n\n' }) });

		const { ok, output } = run({ args: ['--check'] });

		expect(ok).toBe(false);
		expect(output).toContain('pnpm build:config-reference && git add docs/configuration.md');
		// the pass line is exactly what must not appear beside a failure
		expect(output).not.toContain('docs/configuration.md matches configKeyDescriptions');
	});

	test('--check leaves a drifted document exactly as it found it, so measuring never repairs', () => {
		const drifted = withRegion({ region: '\n\nstale row\n\n' });
		const { run, readDocument } = setupConfigKeyReference({ text: drifted });

		run({ args: ['--check'] });
		const after = readDocument();

		expect(after).toBe(drifted);
	});

	test('fails naming the marker it could not find, rather than appending a second reference', () => {
		const { run, readDocument } = setupConfigKeyReference({ text: committedDocument.replace(openMarker, '') });

		const { ok, output } = run();
		const after = readDocument();

		expect(ok).toBe(false);
		expect(output).toContain(`docs/configuration.md holds 0 copies of ${openMarker}`);
		expect(after).not.toContain(openMarker);
	});

	test('fails naming a marker the document holds twice, because a splice across two of them has no one answer', () => {
		const { run } = setupConfigKeyReference({ text: `${committedDocument}\n${closeMarker}\n` });

		const { ok, output } = run();

		expect(ok).toBe(false);
		expect(output).toContain(`docs/configuration.md holds 2 copies of ${closeMarker}`);
	});

	test('fails when the closing marker comes first, which is a region turned inside out rather than a region', () => {
		const { run, readDocument } = setupConfigKeyReference({ text: `# Configuration\n\n${closeMarker}\n\n${openMarker}\n` });

		const { ok, output } = run();
		const after = readDocument();

		expect(ok).toBe(false);
		expect(output).toContain(`docs/configuration.md holds ${closeMarker} before ${openMarker}`);
		expect(after).toBe(`# Configuration\n\n${closeMarker}\n\n${openMarker}\n`);
	});

	test('importing the module writes nothing and fails nothing, so only running it as a command builds', () => {
		const emptied = withRegion({ region: '\n\n' });
		const { importModule, readDocument } = setupConfigKeyReference({ text: emptied });

		const exitCode = importModule();

		expect(exitCode).toBe('undefined');
		expect(readDocument()).toBe(emptied);
	});
});
