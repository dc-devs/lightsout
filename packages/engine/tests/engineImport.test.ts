import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from '@jest/globals';
import { build } from 'esbuild';

// Whether the engine can be imported as a library from outside its own package.
// `pnpm check` cannot see this: TypeScript resolves the source tree directly and
// never reads the `exports` map, so a map naming a file that runs the CLI, or
// omitting an entry a consumer needs, typechecks perfectly and fails only on the
// consumer's machine.

const repoRoot = join(__dirname, '..', '..', '..');
const enginePackage = join(repoRoot, 'packages', 'engine');
const workspaces: string[] = [];

/** A temp package that depends on the engine the way a real consumer does: a link into node_modules. */
const setupConsumer = ({ entry }: { entry: string }) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-import-'));

	workspaces.push(dir);
	mkdirSync(join(dir, 'node_modules', '@lightsout'), { recursive: true });
	symlinkSync(realpathSync(enginePackage), join(dir, 'node_modules', '@lightsout', 'engine'), 'dir');
	writeFileSync(join(dir, 'package.json'), '{ "name": "consumer", "type": "module" }\n');
	writeFileSync(join(dir, 'entry.ts'), entry);

	return dir;
};

afterAll(() => {
	for (const dir of workspaces) {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('a consumer can import the contracts entry under Node type stripping, with no bundler at all', () => {
	// The client-safe half: zod schemas and const objects, no filesystem code. A
	// browser build imports it directly, so it has to load with nothing but Node.
	const dir = setupConsumer({
		entry: ["import { RunStatus } from '@lightsout/engine/contracts';", 'process.stdout.write(RunStatus.Running);'].join('\n'),
	});

	const printed = execFileSync('node', [join(dir, 'entry.ts')], { cwd: dir, encoding: 'utf8' });

	expect(printed).toBe('running');
});

test('a bundled consumer gets the read-side surface, and no CLI runs on import', async () => {
	// The shape every real consumer has — Vite and esbuild both resolve the
	// package root through `exports` and load its TypeScript source. The markdown
	// loader is required because the barrel's module graph reaches the agent
	// prompts, which are imported as strings.
	const dir = setupConsumer({
		entry: ["import { listRunIds, summarizeRun } from '@lightsout/engine';", 'process.stdout.write([typeof listRunIds, typeof summarizeRun].join(","));'].join(
			'\n',
		),
	});
	const bundle = join(dir, 'bundle.mjs');

	await build({
		entryPoints: [join(dir, 'entry.ts')],
		absWorkingDir: dir,
		bundle: true,
		platform: 'node',
		format: 'esm',
		loader: { '.md': 'text' },
		banner: { js: "import { createRequire as __cjsRequire } from 'node:module'; const require = __cjsRequire(import.meta.url);" },
		outfile: bundle,
		logLevel: 'error',
	});

	const result = spawnSync('node', [bundle], { cwd: dir, encoding: 'utf8' });

	expect(result.stdout).toBe('function,function');
	// Silence on stderr is the proof that no CLI ran: main() with no arguments
	// prints the usage text there, so importing the package root having started it
	// could not go unnoticed.
	expect(result.stderr).toBe('');
	expect(result.status).toBe(0);
});
