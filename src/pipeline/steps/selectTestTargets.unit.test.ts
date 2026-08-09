import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runImplementPipeline } from '@/pipeline';
import { linkTypescript } from '@tests/helpers/linkTypescript';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

// The write-tests fan-out is the boundary the inert-file classifier lives
// behind: a source file provably free of executable statements (a barrel, a
// type-only file) earns no test-writer; anything with runtime code does. Every
// file kind is written by one implement stub in a single pipeline run, and the
// observable contract is which files earned a writer vs. were narrated inert.

// Files that PROVABLY hold no executable statement — every top-level statement
// is an import, a re-export, or a pure type declaration.
const inertFiles = {
	// barrel: export * plus a named re-export
	'src/barrelStar.ts': "export * from './add';\nexport { Thing } from './Thing';\n",
	// type re-export barrel
	'src/typeReexport.ts': "export type { Feature } from './feature';\n",
	// type-only file: import type + interface + type alias
	'src/Shape.ts': "import type { Base } from './Base';\n\nexport interface Shape extends Base {\n\tid: number;\n}\n\nexport type Kind = 'a' | 'b';\n",
	// import-then-export barrel
	'src/importThenExport.ts': "import { add } from './add';\n\nexport { add };\n",
	// empty file
	'src/empty.ts': '',
};

// Files that carry executable code — each keeps its writer.
const behavioralFiles = {
	// constant with fallback logic
	'src/config.ts': "export const url = process.env.API_URL ?? 'http://localhost';\n",
	// plain constant (conservative: still a value)
	'src/constants.ts': 'export const LIMIT = 50;\n',
	// enum has runtime code
	'src/Status.ts': 'export enum Status {\n\tOpen,\n\tClosed,\n}\n',
	// function
	'src/add.ts': 'export const add = (a: number, b: number) => a + b;\n',
	// export-default value
	'src/main.ts': 'export default 42;\n',
	// a value + a type in one file — behavioral because the value statement is
	// executable (same-name const+type, the standards check's closed multi-export exception)
	'src/Pair.ts': "export const Pair = {\n\tfirst: 'a',\n} as const;\nexport type Pair = (typeof Pair)[keyof typeof Pair];\n",
	// tsx component parses and has logic
	'src/App.tsx': 'export const App = () => <div>hi</div>;\n',
	// class declaration
	'src/Thing.ts': 'export class Thing {\n\tvalue = 1;\n}\n',
};

test('write-tests fan-out: every executable-code kind earns a writer; barrels and type-only files are inert-skipped', async () => {
	const dir = setupConsumerRepo();

	linkTypescript({ dir });

	const writerTargets: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writerTargets.push(prompt.match(/- (\S+)/)?.[1] ?? 'unknown');
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			// Implement: write one file of every inert and behavioral kind.
			const all = { ...inertFiles, ...behavioralFiles };

			for (const [path, content] of Object.entries(all)) {
				writeFileSync(join(dir, path), content);
			}

			return {
				text: report({ changedFiles: Object.keys(all).map((path) => ({ path, summary: path })) }),
				exitCode: 0,
			};
		},
	};

	const progress: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await loadConfig({ cwd: dir }),
		planPath: 'plan.md',
		onProgress: (message) => progress.push(message),
	});

	expect(result.ok).toBe(true);

	// Every executable-code kind — constant-with-fallback, plain constant, enum,
	// function, export-default, mixed type+value, tsx component, class — earned a
	// writer; no inert file did.
	// only behavioral files earned writers — got:\n${writerTargets.join('\n')}
	expect([...writerTargets].sort()).toStrictEqual(Object.keys(behavioralFiles).sort());

	// Every inert kind — export-* barrel, type re-export, type-only file,
	// import-then-export barrel, empty file — was skipped and named in the narration.
	const inertLine = progress.find((line) => line.includes('inert file(s) skipped'));
	// inert count narrated — got:\n${progress.join('\n')}
	expect(inertLine?.includes(`${Object.keys(inertFiles).length} inert file(s) skipped`)).toBeTruthy();
	for (const path of Object.keys(inertFiles)) {
		// ${path} narrated as inert — got: ${inertLine}
		expect(inertLine?.includes(path)).toBeTruthy();
	}

	// The fan-out count reflects the filtered (behavioral-only) set.
	// fan-out count reflects the filtered set — got:\n${progress.join('\n')}
	expect(progress.some((line) => line.includes('step write-tests') && line.includes(`${Object.keys(behavioralFiles).length} file(s)`))).toBeTruthy();
});

// A pure-removal plan lists deleted files in changed-file truth (git reports
// removals, which legitimately widen scope). A deleted file has no source to
// cover: routing it to a writer asks the agent to test a file that is gone,
// which returns stale-references and escalates the run. The write-tests step
// must skip deletions deterministically — never spawn a writer for them.
test('write-tests fan-out: a deleted source file is skipped, never sent to a writer, and does not escalate the run', async () => {
	const dir = setupConsumerRepo();

	linkTypescript({ dir });

	const writerTargets: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writerTargets.push(prompt.match(/- (\S+)/)?.[1] ?? 'unknown');
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			// Implement: delete the committed source file (a pure removal, as a
			// capability-removal plan does) and add one behavioral file.
			rmSync(join(dir, 'src/index.js'));
			writeFileSync(join(dir, 'src/add.ts'), 'export const add = (a: number, b: number) => a + b;\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'src/index.js', summary: 'removed' },
						{ path: 'src/add.ts', summary: 'added' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	const progress: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await loadConfig({ cwd: dir }),
		planPath: 'plan.md',
		onProgress: (message) => progress.push(message),
	});

	// The deletion no longer escalates — the run completes.
	expect(result.ok).toBe(true);

	// The deleted file was narrated as skipped, naming it.
	const deletedLine = progress.find((line) => line.includes('deleted file(s) skipped'));
	// deleted file narrated and named — got:\n${progress.join('\n')}
	expect(deletedLine?.includes('src/index.js')).toBeTruthy();

	// Only the surviving behavioral file earned a writer; the deletion did not.
	// only the surviving file earned a writer — got:\n${writerTargets.join('\n')}
	expect(writerTargets).toStrictEqual(['src/add.ts']);
});

// A file that cannot be read but IS still on disk is not a deletion. Treating
// the two alike would silently drop a real source file from the test-writing
// fan-out, leaving it uncovered with nothing said about it.
test('write-tests fan-out: an unreadable file that still exists keeps its writer, unlike a deleted one', async () => {
	const dir = setupConsumerRepo();

	linkTypescript({ dir });

	const writerTargets: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writerTargets.push(prompt.match(/- (\S+)/)?.[1] ?? 'unknown');
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			// A directory standing where the source file should be: it exists, so
			// stat succeeds, but readFile cannot produce text for it.
			rmSync(join(dir, 'src/index.js'));
			mkdirSync(join(dir, 'src/index.js'));

			return { text: report({ changedFiles: [{ path: 'src/index.js', summary: 'changed' }] }), exitCode: 0 };
		},
	};

	const progress: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await loadConfig({ cwd: dir }),
		planPath: 'plan.md',
		onProgress: (message) => progress.push(message),
	});

	expect(result.ok).toBe(true);
	// it is on disk, so it is a target — not narrated away as deleted
	expect(writerTargets).toStrictEqual(['src/index.js']);
	expect(progress.some((line) => line.includes('deleted file(s) skipped'))).toBe(false);
});
