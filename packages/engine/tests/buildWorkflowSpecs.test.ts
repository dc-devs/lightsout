import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, test } from '@jest/globals';

// The author-time build of assets/plan-workflow.json, assets/implement-workflow.json
// and assets/refactor-workflow.json, run as the real subprocess `pnpm
// build:workflow-specs` runs it.
//
// What it writes is a committed artifact `build_graphic.py` renders the README's
// infographics from, so the file set, the JSON formatting and the `--check`
// verdict are contracts rather than implementation details — `--check` is wired
// into `pnpm check`, which means its exit code is what blocks a merge.
//
// Every case runs in a throwaway repo root: the script resolves its output
// folder from its own location, so a test that ran it in place would rewrite
// this repo's assets/ and leave the damage behind whenever a test threw. The
// fixture copies scripts/ in and symlinks packages/ back, which is what lets the
// script import the real command catalog while writing somewhere disposable.

const repoRoot = join(__dirname, '..', '..', '..');
const graphicCommands = ['plan', 'implement', 'refactor'];
const roots: string[] = [];

interface Params {
	/** `committed` copies this repo's three specs into the fixture's assets/; `missing` leaves the folder empty. */
	specs?: 'committed' | 'missing';
	/** Catalog ids whose copied spec gains a stray trailing line, so `--check` sees it as drifted. */
	drift?: string[];
}

/**
 * A disposable repo root the script can treat as its own.
 *
 * `packages/` is a symlink rather than a copy: the catalog reaches its
 * contracts through the engine's `#src/*` alias and its schemas through `zod`,
 * and Node resolves both from the real file's location, so the link costs
 * nothing and stays correct as the engine grows.
 */
const setupWorkflowSpecs = ({ specs = 'committed', drift = [] }: Params = {}) => {
	const root = join(mkdtempSync(join(tmpdir(), 'lightsout-workflow-specs-')), 'repo');
	const specPath = ({ id }: { id: string }) => join(root, 'assets', `${id}-workflow.json`);

	roots.push(root);
	mkdirSync(join(root, 'assets'), { recursive: true });
	cpSync(join(repoRoot, 'scripts'), join(root, 'scripts'), { recursive: true });
	symlinkSync(join(repoRoot, 'packages'), join(root, 'packages'), 'dir');

	if (specs === 'committed') {
		for (const id of graphicCommands) {
			cpSync(join(repoRoot, 'assets', `${id}-workflow.json`), specPath({ id }));
		}
	}

	for (const id of drift) {
		appendFileSync(specPath({ id }), 'drift\n');
	}

	/** The script's own verdict: whether it exited 0, and everything it printed on either stream. */
	const run = ({ args = [] }: { args?: string[] } = {}) => {
		try {
			return {
				ok: true,
				output: execFileSync('node', [join(root, 'scripts', 'buildWorkflowSpecs.mjs'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
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
		const scriptUrl = JSON.stringify(`file://${join(root, 'scripts', 'buildWorkflowSpecs.mjs')}`);
		const child = `await import(${scriptUrl}); process.stdout.write(String(process.exitCode));`;

		return execFileSync('node', ['--input-type=module', '-e', child], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	};

	const readSpec = ({ id }: { id: string }) => readFileSync(specPath({ id }), 'utf8');
	const hasSpec = ({ id }: { id: string }) => existsSync(specPath({ id }));

	return { run, importModule, readSpec, hasSpec };
};

afterAll(() => {
	for (const root of roots) {
		rmSync(dirname(root), { recursive: true, force: true });
	}
});

describe('buildWorkflowSpecs', () => {
	test('writes one spec per command that has an infographic, naming each file as it lands', () => {
		const { run } = setupWorkflowSpecs({ specs: 'missing' });

		const { ok, output } = run();

		expect(ok).toBe(true);
		expect(output).toBe('wrote assets/plan-workflow.json\nwrote assets/implement-workflow.json\nwrote assets/refactor-workflow.json\n');
	});

	test('writes the spec shape build_graphic.py reads, with the brand gradient and the disk label the graphic is drawn from', () => {
		const { run, readSpec } = setupWorkflowSpecs({ specs: 'missing' });

		run();
		const spec = JSON.parse(readSpec({ id: 'refactor' }));

		expect(spec).toEqual(
			expect.objectContaining({
				title: expect.any(String),
				subtitle: expect.any(String),
				columns: expect.any(Number),
				savedLabel: 'SAVED TO DISK',
				theme: { from: '#35d6e8', to: '#b06bf5' },
				banner: expect.any(String),
				cards: expect.arrayContaining([
					expect.objectContaining({
						title: expect.any(String),
						// the gradient end a card is painted from — the one machine-facing field on a card
						tag: expect.objectContaining({ label: expect.any(String), tone: expect.stringMatching(/^(from|to)$/) }),
						bullets: expect.any(Array),
						saved: expect.any(Array),
					}),
				]),
			}),
		);
	});

	test('rewrites every committed spec byte for byte, so a rebuild of an up-to-date tree shows no diff', () => {
		const { run, readSpec } = setupWorkflowSpecs();
		const before = graphicCommands.map((id) => readSpec({ id }));

		run();
		const after = graphicCommands.map((id) => readSpec({ id }));

		expect(after).toStrictEqual(before);
	});

	test('writes two-space JSON ending in a newline, the formatting the committed specs are read and diffed in', () => {
		const { run, readSpec } = setupWorkflowSpecs({ specs: 'missing' });

		run();
		const written = readSpec({ id: 'plan' });

		expect(written.startsWith('{\n  "title": ')).toBe(true);
		expect(written.endsWith('}\n')).toBe(true);
	});

	test('--check passes on the specs this repo has committed, which is what makes them trustworthy', () => {
		const { run } = setupWorkflowSpecs();

		const { ok, output } = run({ args: ['--check'] });

		expect(ok).toBe(true);
		expect(output).toBe('assets/*-workflow.json match the command catalog\n');
	});

	test('--check fails and names every spec that drifted, not just the first', () => {
		const { run } = setupWorkflowSpecs({ drift: ['plan', 'refactor'] });

		const { ok, output } = run({ args: ['--check'] });

		expect(ok).toBe(false);
		expect(output).toContain('assets/plan-workflow.json, assets/refactor-workflow.json no longer matches the command catalog');
		expect(output).toContain('pnpm build:workflow-specs && git add assets/');
	});

	test('--check leaves a drifted spec exactly as it found it, so measuring never repairs', () => {
		const { run, readSpec } = setupWorkflowSpecs({ drift: ['refactor'] });
		const before = readSpec({ id: 'refactor' });

		run({ args: ['--check'] });
		const after = readSpec({ id: 'refactor' });

		expect(after).toBe(before);
		expect(after.endsWith('drift\n')).toBe(true);
	});

	test('--check fails with the read error rather than a false pass when a spec is not on disk at all', () => {
		const { run, hasSpec } = setupWorkflowSpecs({ specs: 'missing' });

		const { ok, output } = run({ args: ['--check'] });

		expect(ok).toBe(false);
		expect(output).toContain('plan-workflow.json');
		// the read failed, so the pass line is exactly what must not appear
		expect(output).not.toContain('match the command catalog');
		expect(hasSpec({ id: 'plan' })).toBe(false);
	});

	test('importing the module writes nothing and fails nothing, so only running it as a command builds', () => {
		const { importModule, hasSpec } = setupWorkflowSpecs({ specs: 'missing' });

		const exitCode = importModule();

		expect(exitCode).toBe('undefined');
		expect(graphicCommands.map((id) => hasSpec({ id }))).toStrictEqual([false, false, false]);
	});
});
