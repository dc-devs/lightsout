import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { expectDefined } from '@tests/helpers/expectDefined';
import { linkTypescript } from '@tests/helpers/linkTypescript';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { loadConfig } from '@/common/utils/loadConfig';
import type { Driver } from '@/drivers';
import { runImplementPipeline } from '@/pipeline';

test('write-tests fan-out: files that import each other share ONE writer; unrelated files stay parallel', async () => {
	const dir = setupConsumerRepo();

	linkTypescript({ dir });

	const writerPrompts: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writerPrompts.push(prompt);

				const testFile = `test/writer-${writerPrompts.length}.test.js`;

				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, testFile), '// stub\n');

				return { text: report({ changedFiles: [{ path: testFile, summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			// Implement: a boundary importing an internal, plus one unrelated file.
			writeFileSync(join(dir, 'src/helper.ts'), 'export const helper = (n: number): number => n + 1;\n');
			writeFileSync(join(dir, 'src/feature.ts'), `import { helper } from './helper';\n\nexport const feature = (n: number): number => helper(n) * 2;\n`);
			writeFileSync(join(dir, 'src/other.ts'), 'export const other = (): number => 3;\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'src/feature.ts', summary: 'boundary' },
						{ path: 'src/helper.ts', summary: 'internal' },
						{ path: 'src/other.ts', summary: 'unrelated' },
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

	expect(result.ok).toBe(true);
	// two import components — two writers, not three
	expect(writerPrompts.length).toBe(2);

	const grouped = writerPrompts.find((prompt) => prompt.includes('src/feature.ts'));
	const solo = writerPrompts.find((prompt) => prompt.includes('src/other.ts'));

	// boundary and its internal share one writer
	expect(grouped?.includes('src/helper.ts')).toBeTruthy();
	// the assignment names its subjects and the changed files that must execute
	expect(grouped?.includes('# Test subjects — write tests through these public surfaces')).toBeTruthy();
	expect(grouped?.includes('# Changed internals that must execute under those tests')).toBeTruthy();
	// unrelated file gets its own writer
	expectDefined(solo);
	expect(solo.includes('src/feature.ts')).toBeFalsy();
	expect(solo.includes('src/helper.ts')).toBeFalsy();
	// every assignment carries the binding subject rule
	expect(solo.includes('Never create a test file for any file outside the subjects list')).toBeTruthy();
	// grouping narrated — got:\n${progress.join('\n')}
	expect(progress.some((line) => line.includes('2 group(s): 3 subject(s) covering 3 changed file(s)'))).toBeTruthy();
});

test('write-tests fan-out: two internals sharing an UNCHANGED public subject group into one writer, with the subject leading the assignment', async () => {
	const dir = setupConsumerRepo();

	linkTypescript({ dir });

	// The module pre-exists the run: its barrel exports pub.ts only, and pub.ts
	// imports both internals — the run will change ONLY the internals.
	mkdirSync(join(dir, 'src/mod'), { recursive: true });
	writeFileSync(join(dir, 'src/mod/index.ts'), "export { pub } from './pub';\n");
	writeFileSync(join(dir, 'src/mod/pub.ts'), "import { a } from './a';\nimport { b } from './b';\n\nexport const pub = (): number => a() + b();\n");
	writeFileSync(join(dir, 'src/mod/a.ts'), 'export const a = (): number => 1;\n');
	writeFileSync(join(dir, 'src/mod/b.ts'), 'export const b = (): number => 2;\n');
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm module', { cwd: dir });

	const writerPrompts: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writerPrompts.push(prompt);

				const testFile = `test/writer-${writerPrompts.length}.test.js`;

				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, testFile), '// stub\n');

				return { text: report({ changedFiles: [{ path: testFile, summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			// Implement: both internals change; pub.ts and the barrel do not.
			writeFileSync(join(dir, 'src/mod/a.ts'), 'export const a = (): number => 10;\n');
			writeFileSync(join(dir, 'src/mod/b.ts'), 'export const b = (): number => 20;\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'src/mod/a.ts', summary: 'internal' },
						{ path: 'src/mod/b.ts', summary: 'internal' },
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

	expect(result.ok).toBe(true);
	// no import edge joins a.ts and b.ts — the shared subject alone makes them one writer
	expect(writerPrompts.length).toBe(1);
	// the unchanged public file is the subject; the changed internals ride the must-execute list
	expect(
		writerPrompts[0]?.includes(
			'# Test subjects — write tests through these public surfaces\n\n- src/mod/pub.ts\n\n# Changed internals that must execute under those tests\n\n- src/mod/a.ts\n- src/mod/b.ts',
		),
	).toBeTruthy();
	// the unchanged subject is what the run records for fix re-invocations
	expect(result.manifest.testSubjects).toStrictEqual(['src/mod/pub.ts']);
	// the counts narrate subjects and changed files separately — got:\n${progress.join('\n')}
	expect(progress.some((line) => line.includes('1 group(s): 1 subject(s) covering 2 changed file(s)'))).toBeTruthy();
});

// An import component larger than the writer cap would hand one agent a
// pathological amount of context. It is split into sorted chunks instead, and
// the split is narrated so the run explains why one concept got two writers.
test('write-tests fan-out: an import component above the writer cap splits into chunks, and says so', async () => {
	const dir = setupConsumerRepo();

	linkTypescript({ dir });

	const writerPrompts: string[] = [];
	const chainLength = 14;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writerPrompts.push(prompt);

				const testFile = `test/writer-${writerPrompts.length}.test.js`;

				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, testFile), '// stub\n');

				return { text: report({ changedFiles: [{ path: testFile, summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			// One chain: every file imports the next, so they form a single
			// connected component longer than the cap.
			const changedFiles = [];

			for (let index = 0; index < chainLength; index += 1) {
				const next = index + 1 < chainLength ? `import { link${index + 1} } from './link${index + 1}';\n` : '';
				const body = `export const link${index} = (): number => ${index + 1 < chainLength ? `link${index + 1}()` : index};\n`;

				writeFileSync(join(dir, `src/link${index}.ts`), `${next}\n${body}`);
				changedFiles.push({ path: `src/link${index}.ts`, summary: 'chain' });
			}

			return { text: report({ changedFiles }), exitCode: 0 };
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

	const splitLine = progress.find((line) => line.includes('exceeds the'));

	expectDefined(splitLine);
	expect(splitLine).toMatch(/import component of 14 files exceeds the 12-file writer cap/);
	// one oversized component becomes more than one writer
	expect(writerPrompts.length).toBeGreaterThan(1);
});
