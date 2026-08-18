import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { linkTypescript } from '@tests/helpers/linkTypescript';
import { report } from '@tests/helpers/report';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { loadConfig } from '@/common/utils/loadConfig';
import type { RunManifest } from '@/contracts';
import { runCoveragePipeline } from '@/coverage';
import type { Driver } from '@/drivers';

/**
 * The consumer's own coverage gate, as a real command: it reads the scope's
 * summary and exits 0 only once the total clears the repo's threshold. The
 * engine never learns that number — it only ever sees the exit code.
 */
const coverageGate = `const { resolve } = require('node:path');
const summary = require(resolve(process.argv[2] ?? '.', 'coverage/coverage-summary.json'));
process.exit(summary.total.statements.pct >= 95 ? 0 : 1);
`;

/** Write a scope's summary from its per-file percentages, with the total averaged over them. */
const writeSummary = ({ dir, scopeDir = '.', files }: { dir: string; scopeDir?: string; files: Record<string, number> }) => {
	const percentages = Object.values(files);
	const total = percentages.length === 0 ? 100 : percentages.reduce((sum, pct) => sum + pct, 0) / percentages.length;

	mkdirSync(join(dir, scopeDir, 'coverage'), { recursive: true });
	writeFileSync(
		join(dir, scopeDir, 'coverage/coverage-summary.json'),
		JSON.stringify({
			total: { statements: { pct: total } },
			...Object.fromEntries(Object.entries(files).map(([file, pct]) => [join(dir, file), { statements: { pct } }])),
		}),
	);
};

const readSummary = ({ dir, scopeDir = '.' }: { dir: string; scopeDir?: string }) =>
	JSON.parse(readFileSync(join(dir, scopeDir, 'coverage/coverage-summary.json'), 'utf8')) as Record<string, { statements: { pct: number } }>;

/** A single-package consumer whose measured files start at the given percentages. */
const setupRepo = ({ files, check = 'true', contents = {} }: { files: Record<string, number>; check?: string; contents?: Record<string, string> }) => {
	const dir = setupConsumerRepo({ git: false, scripts: { check, 'test-coverage': 'node coverageGate.cjs' }, config: { standardsPackages: false } });

	writeFileSync(join(dir, 'coverageGate.cjs'), coverageGate);

	for (const file of Object.keys(files)) {
		mkdirSync(join(dir, file, '..'), { recursive: true });
		writeFileSync(join(dir, file), contents[file] ?? 'export const value = () => 1;\n');
	}

	writeSummary({ dir, files });
	execSync(
		'git init -q && printf "coverage/\\nnode_modules/\\n.lightsout/\\n" > .gitignore && git add -A && git -c user.name=t -c user.email=t@t commit -qm init',
		{ cwd: dir },
	);

	return dir;
};

/** A monorepo whose packages measure themselves, one already over the threshold. */
const setupMonorepoRepo = ({ scopes }: { scopes: Record<string, Record<string, number>> }) => {
	const dir = setupConsumerRepo({
		git: false,
		scripts: { 'test-coverage': 'node coverageGate.cjs' },
		config: {
			standardsPackages: false,
			packageGates: { check: 'true {package}', test: 'true {package}', 'test-coverage': 'node coverageGate.cjs packages/{package}' },
		},
	});

	writeFileSync(join(dir, 'coverageGate.cjs'), coverageGate);

	for (const [packageDir, files] of Object.entries(scopes)) {
		mkdirSync(join(dir, 'packages', packageDir, 'src'), { recursive: true });
		writeFileSync(join(dir, 'packages', packageDir, 'package.json'), JSON.stringify({ name: packageDir }));

		for (const file of Object.keys(files)) {
			writeFileSync(join(dir, file), 'export const value = () => 1;\n');
		}

		writeSummary({ dir, scopeDir: join('packages', packageDir), files });
	}

	execSync(
		'git init -q && printf "coverage/\\nnode_modules/\\n.lightsout/\\n" > .gitignore && git add -A && git -c user.name=t -c user.email=t@t commit -qm init',
		{ cwd: dir },
	);

	return dir;
};

/** The files a writer invocation was handed, read back out of its prompt — each appears under both the subjects and must-execute headers, so the read-back dedupes. */
const listedFiles = ({ prompt }: { prompt: string }) => [...new Set([...prompt.matchAll(/^- (\S+)$/gm)].map((match) => match[1]))];

/**
 * A stub writer: it writes a test file for each target it is willing to cover
 * and re-measures them to `pct`. `covers` decides which of the batch's files it
 * actually moves — everything else is left exactly where it was.
 */
const stubWriter = ({
	dir,
	pct = 100,
	covers = () => true,
	limit = Number.POSITIVE_INFINITY,
}: {
	dir: string;
	pct?: number;
	covers?: (file: string) => boolean;
	limit?: number;
}) => {
	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			prompts.push(prompt);

			const measured = readSummary({ dir });
			const files = Object.fromEntries(
				Object.entries(measured)
					.filter(([key]) => key !== 'total')
					.map(([key, entry]) => [key.slice(`${dir}/`.length), entry.statements.pct]),
			);
			const targets = listedFiles({ prompt })
				.filter((file) => covers(file) && Object.hasOwn(files, file) && files[file] < pct)
				.slice(0, limit);
			const written = targets.map((file) => `${file.replace(/\.[^.]+$/, '')}.unit.test.ts`);

			for (const [index, file] of targets.entries()) {
				writeFileSync(join(dir, written[index]), 'test("covers", () => undefined);\n');
				files[file] = pct;
			}

			writeSummary({ dir, files });

			return { text: report({ changedFiles: written.map((file) => ({ path: file, summary: 'covers its module' })) }), exitCode: 0 };
		},
	};

	return { driver, prompts };
};

const runPipeline = async ({ dir, driver, maxBatches, existing }: { dir: string; driver: Driver; maxBatches?: number; existing?: RunManifest }) =>
	runCoveragePipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), maxBatches, existing });

describe('runCoveragePipeline', () => {
	test('a repo already over its threshold ends green without spawning anything', async () => {
		const dir = setupRepo({ files: { 'src/a.ts': 100 } });
		const { driver, prompts } = stubWriter({ dir });

		const result = await runPipeline({ dir, driver });

		expect(result.ok).toBe(true);
		expect(result.manifest.status).toBe('passed');
		expect(prompts.length).toBe(0);
		expect(result.after).toStrictEqual([{ scope: 'root', statementsPct: 100, passed: true }]);
	});

	test("the consumer's own exit code ends the run: batches repeat until the gate goes green", async () => {
		const dir = setupRepo({ files: { 'src/a.ts': 10, 'src/b.ts': 20 } });
		const { driver, prompts } = stubWriter({ dir, limit: 1 });

		const result = await runPipeline({ dir, driver });

		expect(result.ok).toBe(true);
		// one file covered per round, so the gate took two batches to go green
		expect(result.manifest.steps.filter((step) => step.id.startsWith('batch-')).map((step) => step.id)).toStrictEqual(['batch-01:root', 'batch-02:root']);
		expect(prompts.length).toBe(2);
		expect(result.before[0]?.statementsPct).toBe(15);
		expect(result.after[0]?.statementsPct).toBe(100);
		// the tests are in the tree; the engine never commits them
		expect(result.manifest.changedFiles).toStrictEqual(['src/a.unit.test.ts', 'src/b.unit.test.ts']);
	});

	test('the batch ceiling parks the run with the command that resumes it', async () => {
		const dir = setupRepo({ files: { 'src/a.ts': 10, 'src/b.ts': 20 } });
		const { driver } = stubWriter({ dir, limit: 1 });

		const result = await runPipeline({ dir, driver, maxBatches: 1 });

		expect(result.ok).toBe(false);
		expect(result.manifest.status).toBe('paused-budget');
		expect(result.error ?? '').toContain(`lightsout test-coverage-to-threshold --run ${result.manifest.runId}`);
		// a parked run measured nothing final — its after echoes before
		expect(result.after).toStrictEqual(result.before);
	});

	test('a resumed run continues the batch numbering and keeps its earlier work', async () => {
		const dir = setupRepo({ files: { 'src/a.ts': 10, 'src/b.ts': 20 } });
		const { driver } = stubWriter({ dir, limit: 1 });
		const parked = await runPipeline({ dir, driver, maxBatches: 1 });

		const resumed = await runPipeline({ dir, driver, existing: parked.manifest });

		expect(resumed.ok).toBe(true);
		// numbering continues from the persisted records, not from process memory
		expect(resumed.manifest.steps.filter((step) => step.id.startsWith('batch-')).map((step) => step.id)).toStrictEqual(['batch-01:root', 'batch-02:root']);
	});

	test('a batch that moved nothing is declined, and its files never come back', async () => {
		const dir = setupRepo({ files: { 'src/a.ts': 10 } });
		const { driver, prompts } = stubWriter({ dir, covers: () => false });

		const result = await runPipeline({ dir, driver });

		expect(result.ok).toBe(false);
		expect(result.setAside).toStrictEqual([{ batchId: 'batch-01:root', files: ['src/a.ts'], rationale: [] }]);
		// the second round found nothing left to try, and said why in both directions
		expect(result.error ?? '').toMatch(/set-aside files need source changes, or the threshold binds on a metric other than statements/);
		expect(result.manifest.status).toBe('escalated');
		expect(prompts.length).toBe(1);
	});

	test('three consecutive declines stop the run as systemic', async () => {
		const files: Record<string, number> = {};

		for (let index = 0; index < 15; index += 1) {
			files[`src/f${String(index).padStart(2, '0')}.ts`] = 10;
		}

		const dir = setupRepo({ files });
		const { driver } = stubWriter({ dir, covers: () => false });

		const result = await runPipeline({ dir, driver });

		expect(result.ok).toBe(false);
		expect(result.error ?? '').toMatch(/3 consecutive batches declined/);
		expect(result.manifest.status).toBe('escalated');
		expect(result.setAside.length).toBe(3);
	});

	test('a file carried through three improving batches without improving is set aside on its own', async () => {
		const dir = setupRepo({ files: { 'src/stuck.ts': 10, 'src/m1.ts': 10, 'src/m2.ts': 10, 'src/m3.ts': 10 } });
		const { driver } = stubWriter({ dir, covers: (file) => !file.includes('stuck'), limit: 1 });

		const result = await runPipeline({ dir, driver });

		// the free-rider guard: an improving batch would shelter it forever
		expect(result.setAside).toStrictEqual([
			{ batchId: 'batch-03:root', files: ['src/stuck.ts'], rationale: ['no improvement across 3 batches — likely needs source changes'] },
		]);
		expect(result.ok).toBe(false);
	});

	test('a writer that reaches for source stops the run, leaving the tree for a human', async () => {
		const dir = setupRepo({ files: { 'src/a.ts': 10 } });
		const driver: Driver = {
			name: 'stub',
			invoke: async () => {
				writeFileSync(join(dir, 'src/a.ts'), 'export const value = () => 2;\n');

				return { text: report({ changedFiles: [{ path: 'src/a.ts', summary: 'reworked the module' }] }), exitCode: 0 };
			},
		};

		const result = await runPipeline({ dir, driver });

		expect(result.ok).toBe(false);
		expect(result.manifest.status).toBe('failed');
		expect(result.error ?? '').toContain('src/a.ts');
		// the batch's own record carries the stop, so a resume sees where it happened
		expect(result.manifest.steps.find((step) => step.id === 'batch-01:root')?.status).toBe('failed');
	});

	test('an ambiguity the writer cannot resolve escalates the whole run to a human', async () => {
		const dir = setupRepo({ files: { 'src/a.ts': 10 } });
		const driver: Driver = {
			name: 'stub',
			invoke: async () => ({ text: report({ status: 'terminated:ambiguity', failures: ['which module owns this file?'] }), exitCode: 0 }),
		};

		const result = await runPipeline({ dir, driver });

		expect(result.manifest.status).toBe('escalated');
		expect(result.error ?? '').toContain('which module owns this file?');
	});

	test('a rate-limited harness parks the run with the resume hint', async () => {
		const dir = setupRepo({ files: { 'src/a.ts': 10 } });
		const driver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 1, rateLimited: true }) };

		const result = await runPipeline({ dir, driver });

		expect(result.manifest.status).toBe('paused-rate-limit');
		expect(result.error ?? '').toContain(`lightsout test-coverage-to-threshold --run ${result.manifest.runId}`);
	});

	test('a red pre-flight gate fails the run before any batch, because a batch cannot be blamed for it', async () => {
		const dir = setupRepo({ files: { 'src/a.ts': 10 }, check: 'false' });
		const { driver, prompts } = stubWriter({ dir });

		const result = await runPipeline({ dir, driver });

		expect(result.ok).toBe(false);
		expect(result.manifest.status).toBe('failed');
		expect(result.error ?? '').toMatch(/not green before raising coverage/);
		expect(prompts.length).toBe(0);
	});

	test('without a consumer TypeScript every component is one file, so a batch is plain worst-first', async () => {
		const files: Record<string, number> = {};

		for (let index = 0; index < 7; index += 1) {
			files[`src/f${index}.ts`] = index;
		}

		const dir = setupRepo({ files });
		const { driver, prompts } = stubWriter({ dir });

		await runPipeline({ dir, driver });

		// no import graph to group by — the batch is exactly the five worst files
		expect(listedFiles({ prompt: prompts[0] ?? '' })).toStrictEqual(['src/f0.ts', 'src/f1.ts', 'src/f2.ts', 'src/f3.ts', 'src/f4.ts']);
	});

	test('work only ever goes to a package whose own gate is red', async () => {
		const dir = setupMonorepoRepo({
			scopes: { api: { 'packages/api/src/a.ts': 10 }, web: { 'packages/web/src/b.ts': 100 } },
		});
		const prompts: string[] = [];
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				prompts.push(prompt);
				writeFileSync(join(dir, 'packages/api/src/a.unit.test.ts'), 'test("covers", () => undefined);\n');
				writeSummary({ dir, scopeDir: 'packages/api', files: { 'packages/api/src/a.ts': 100 } });

				return { text: report({ changedFiles: [{ path: 'packages/api/src/a.unit.test.ts', summary: 'covers a' }] }), exitCode: 0 };
			},
		};

		const result = await runPipeline({ dir, driver });

		expect(result.ok).toBe(true);
		// the batch is scoped to the failing package, so re-measuring re-runs only its suite
		expect(result.manifest.steps.filter((step) => step.id.startsWith('batch-')).map((step) => step.id)).toStrictEqual(['batch-01:api']);
		// the green package's file is never handed to a writer
		expect(listedFiles({ prompt: prompts[0] ?? '' })).toStrictEqual(['packages/api/src/a.ts']);
		expect(result.after).toStrictEqual([
			{ scope: 'api', statementsPct: 100, passed: true },
			{ scope: 'web', statementsPct: 100, passed: true },
		]);
	});

	test('a barrel, a type-only file and a non-source file are never handed to a writer', async () => {
		const contents = {
			'src/barrel.ts': "export { value } from '@/elsewhere';\n",
			'src/types.ts': 'export interface Shape {\n\tside: number;\n}\n',
			'src/styles.css': '.a { color: red; }\n',
		};
		const dir = setupRepo({ files: { 'src/barrel.ts': 0, 'src/types.ts': 0, 'src/styles.css': 0, 'src/real.ts': 40 }, contents });

		linkTypescript({ dir });

		const { driver, prompts } = stubWriter({ dir });

		await runPipeline({ dir, driver });

		// untestable files sit at the bottom of a statements ordering and would
		// fill every early batch with guaranteed declines
		expect(listedFiles({ prompt: prompts[0] ?? '' })).toStrictEqual(['src/real.ts']);
	});
});
