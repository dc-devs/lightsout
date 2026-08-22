// The gate-and-scoping half of runCoveragePipeline, split from
// runCoveragePipeline.unit.test.ts when that file passed the test-file line
// cap. Its fixtures are its own: the rule that forced the split says each half
// carries what it needs, and test files are exempt from the duplication rules.

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { RunManifest } from '#src/contracts/index.ts';
import { runCoveragePipeline } from '#src/coverage/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';
import { report } from '#tests/helpers/report.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

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
	const dir = setupConsumerRepo({ git: false, scripts: { check, 'test-coverage': 'node coverageGate.cjs' }, config: { 'standards-packs': false } });

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

/**
 * The human's move between a failed pre-flight and a resume: turn the red check
 * gate green and commit it, so the tree the resumed run measures is still clean.
 */
const repairCheckGate = ({ dir }: { dir: string }) => {
	const configPath = join(dir, 'lightsout.config.json');
	const config = JSON.parse(readFileSync(configPath, 'utf8')) as { gates: Record<string, string | false> };

	writeFileSync(configPath, JSON.stringify({ ...config, gates: { ...config.gates, check: 'true' } }));
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm repair', { cwd: dir });
};

/** A monorepo whose packages measure themselves, one already over the threshold. */
const setupMonorepoRepo = ({ scopes }: { scopes: Record<string, Record<string, number>> }) => {
	const dir = setupConsumerRepo({
		git: false,
		scripts: { 'test-coverage': 'node coverageGate.cjs' },
		config: {
			'standards-packs': false,
			'package-gates': { check: 'true {package}', test: 'true {package}', 'test-coverage': 'node coverageGate.cjs packages/{package}' },
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

const runPipeline = async ({
	dir,
	driver,
	maxBatches,
	existing,
	onProgress,
}: {
	dir: string;
	driver: Driver;
	maxBatches?: number;
	existing?: RunManifest;
	onProgress?: (message: string) => void;
}) => runCoveragePipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), maxBatches, existing, onProgress });

describe('runCoveragePipeline gates and scoping', () => {
	test('a red pre-flight gate fails the run before any batch, because a batch cannot be blamed for it', async () => {
		const dir = setupRepo({ files: { 'src/a.ts': 10 }, check: 'false' });
		const { driver, prompts } = stubWriter({ dir });

		const result = await runPipeline({ dir, driver });

		expect(result.ok).toBe(false);
		expect(result.manifest.status).toBe('failed');
		expect(result.error ?? '').toMatch(/not green before raising coverage/);
		expect(prompts.length).toBe(0);
	});

	test('a resumed run re-runs a pre-flight that never passed, counting the retry as a second attempt', async () => {
		const dir = setupRepo({ files: { 'src/a.ts': 10 }, check: 'false' });
		const { driver, prompts } = stubWriter({ dir });
		const failed = await runPipeline({ dir, driver });

		repairCheckGate({ dir });

		const resumed = await runPipeline({ dir, driver, existing: failed.manifest });

		// only a PASSED pre-flight is skipped on resume — a failed one is the
		// reason the run stopped, so the resume has to answer it again
		expect(resumed.manifest.steps.find((step) => step.id === 'pre-flight')).toStrictEqual({ id: 'pre-flight', status: 'passed', attempts: 2 });
		// with the gate green the round proceeds, so the resume is not a re-park
		expect(resumed.ok).toBe(true);
		expect(prompts.length).toBe(1);
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
