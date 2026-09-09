import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { RefactorStepReport } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

// The standards gate: findings feed the refactor prompt, attribution against
// the pre-edit baseline decides which of them is this run's own work, and the
// config switch is honored.

interface AttributionDriverParams {
	dir: string;
	/** Repo-relative test file the writer plants. */
	testFile: string;
	/** The run's own edits; answers the repo-relative paths it reports. */
	implement: () => string[];
	/** Collects every prompt the cleanup executor was handed. */
	refactorPrompts: string[];
	onReview?: () => void;
	/** Answers one cleanup round, by its 1-based number. The default declines every round. */
	onRefactor?: (params: { pass: number }) => string;
}

/**
 * A stub agent for the gate fixtures below. The reviewer and the test writer
 * answer identically in all of them, so a fixture states only its own two
 * turns: the edits the run makes, and what each cleanup round does. Left to its
 * default that round declines, so whatever qualified as work has to still be
 * standing when cleanup ends.
 */
const attributionDriver = ({ dir, testFile, implement, refactorPrompts, onReview, onRefactor = () => report() }: AttributionDriverParams): Driver => ({
	name: 'stub',
	invoke: withTestChangeReview({
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				onReview?.();

				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				mkdirSync(join(dir, dirname(testFile)), { recursive: true });
				writeFileSync(join(dir, testFile), '// stub\n');

				return { text: report({ changedFiles: [{ path: testFile, summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				refactorPrompts.push(prompt);

				return { text: onRefactor({ pass: refactorPrompts.length }), exitCode: 0 };
			}

			return { text: report({ changedFiles: implement().map((path) => ({ path, summary: 'feature' })) }), exitCode: 0 };
		},
	}),
});

/**
 * A source file already over the line cap: a note line, padding, and one
 * export. The note is what lets two files of the same length differ in content,
 * so a rewrite that adds no line is still a real edit.
 */
const overCapSource = ({ name, note, pad }: { name: string; note: string; pad: number }) =>
	`// ${note}\n${'// pad\n'.repeat(pad)}export const ${name} = () => 1;\n`;

test('standards gate: findings feed the refactor prompt; a fixing pass clears the gate', async () => {
	const dir = setupConsumerRepo();
	const prompts: string[] = [];
	const driver = attributionDriver({
		dir,
		testFile: 'test/messy.test.js',
		refactorPrompts: prompts,
		// Implement plants a multi-export violation — the standards gate's target.
		implement: () => {
			writeSource({ dir, path: 'src/messy.js', source: 'export const first = () => 1;\nexport const second = () => 2;\n' });

			return ['src/messy.js'];
		},
		// First pass fixes the planted multi-export; later passes are clean. The
		// fixed file exports nothing at all, so no advisory (a filename mismatch,
		// an unconsumed export) survives to keep the section alive.
		onRefactor: ({ pass }) => {
			if (pass > 1) {
				return report();
			}

			writeFileSync(join(dir, 'src/messy.js'), "import { one } from './index.js';\n\nconsole.log(one);\n");

			return report({ changedFiles: [{ path: 'src/messy.js', summary: 'split exports' }] });
		},
	});

	const progress: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await readConfig({ cwd: dir }),
		planPath: 'plan.md',
		onProgress: (message) => progress.push(message),
	});

	expect(result.ok).toBe(true);
	// gate narrated the finding — the work-list count IS the blocking count now,
	// so there is no second number to print
	expect(progress.some((line) => line.startsWith('standards gate: 1 blocking'))).toBeTruthy();
	// findings section injected into the refactor prompt
	expect(prompts[0]?.includes('# Standards findings')).toBeTruthy();
	// the planted violation named in the work-list
	expect(prompts[0]?.includes('[multi-export] src/messy.js')).toBeTruthy();
	// clean tree injects no findings section
	expect(prompts[1]?.includes('# Standards findings')).toBeFalsy();
	// because the fixing pass cleared the gate, so no second round was ever bought
	expect(RefactorStepReport.parse(result.manifest.steps.find((step) => step.id === 'refactor')?.report)).toEqual(
		expect.objectContaining({ roundsUsed: 1, endReason: 'clean', remaining: [] }),
	);
});

test('standards default on when unspecified; false switches them off explicitly', async () => {
	const run = async ({ config }: { config: Record<string, unknown> }) => {
		const dir = setupConsumerRepo({ config });
		let implementPrompt = '';
		const driver: Driver = {
			name: 'stub',
			invoke: withTestChangeReview({
				invoke: async ({ prompt, systemPrompt }) => {
					if (roleOf(prompt) === 'implement') {
						// Standards ride the system prompt — stable for the run, so cached.
						implementPrompt = systemPrompt ?? '';

						return { text: report({ status: 'failed', failures: ['stop early'] }), exitCode: 0 };
					}

					return { text: report(), exitCode: 0 };
				},
			}),
		};

		await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

		return implementPrompt;
	};

	const defaulted = await run({ config: {} });

	// unspecified → standards section present
	expect(defaulted.includes('# Standards\n\nThese rules are binding')).toBeTruthy();
	// bundled defaults inlined
	expect(defaulted.includes('One Export Per File')).toBeTruthy();

	const disabled = await run({ config: { 'standards-packs': false } });

	// false → no standards section
	expect(disabled.includes('# Standards\n\nThese rules are binding')).toBeFalsy();
});

test('a declared standards pack that cannot be loaded stops the run before any agent spawns', async () => {
	const dir = setupConsumerRepo({ config: { 'standards-packs': ['standards/ghost'] } });
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('no agent should be invoked');
		},
	};
	const progress: string[] = [];

	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await readConfig({ cwd: dir }),
		planPath: 'plan.md',
		onProgress: (message) => progress.push(message),
	});

	// a consumer that declared standards and did not get them must not run: the
	// load failure comes back as a failed manifest, never as a thrown crash that
	// would leave the run with no record of why it ended
	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/standards pack root file not found/);

	const cleanSlate = result.manifest.steps.find((step) => step.id === 'clean-slate');

	// the run stopped at the first step without ever attempting it — a zero
	// attempt count is what distinguishes "never started" from "ran and failed"
	expect(cleanSlate?.status).toBe('failed');
	expect(cleanSlate?.attempts).toBe(0);
	expect(progress.some((line) => line.startsWith('run stopped at clean-slate'))).toBeTruthy();
});

/**
 * A run whose implement step lands one clean source file and whose refactor
 * pass declines, so the config is the only thing left deciding what the
 * standards half of the gate does. The reviewer's system prompt is collected —
 * it carries the rules the pack and channel resolution selected, so it is where
 * a config the gate failed to honor shows up — and an empty list of prompts is
 * a review that was never bought at all.
 */
const setupStandardsConfigRun = async ({ config }: { config: Record<string, unknown> }) => {
	const dir = setupConsumerRepo({ config });
	const reviewSystemPrompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt, systemPrompt }) => {
				const role = roleOf(prompt);

				if (role === 'standards-review') {
					reviewSystemPrompts.push(systemPrompt ?? '');

					return { text: reviewReport(), exitCode: 0 };
				}

				if (role === 'write-tests') {
					mkdirSync(join(dir, 'test'), { recursive: true });
					writeFileSync(join(dir, 'test/subject.test.js'), '// stub\n');

					return { text: report({ changedFiles: [{ path: 'test/subject.test.js', summary: 'tests' }] }), exitCode: 0 };
				}

				if (role === 'refactor') {
					return { text: report({ changedFiles: [] }), exitCode: 0 };
				}

				writeSource({ dir, path: 'src/subject.js', source: 'export const subject = () => 1;\n' });

				return { text: report({ changedFiles: [{ path: 'src/subject.js', summary: 'feature' }] }), exitCode: 0 };
			},
		}),
	};

	return { dir, driver, config: await readConfig({ cwd: dir }), reviewSystemPrompts };
};

test('standards packs off: the refactor gate loads no pack, spends no reviewer, and the loop still completes', async () => {
	const { dir, driver, config, reviewSystemPrompts } = await setupStandardsConfigRun({ config: { 'standards-packs': false } });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	// no pack means no judgment rule to read, so no agent is spent saying so —
	// and the machine half having nothing to report is what lets the loop finish
	expect(reviewSystemPrompts).toStrictEqual([]);
	expect(result.ok).toBe(true);
	expect(result.manifest.steps.find((step) => step.id === 'refactor')?.status).toBe('passed');
});

test('standards channels configured: the refactor gate hands the reviewer the named channel rather than what it would detect', async () => {
	const { dir, driver, config, reviewSystemPrompts } = await setupStandardsConfigRun({ config: { 'standards-channels': ['react'] } });

	await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	// the fixture repo carries no manifest at all, so detection would have found
	// no channel and left both of these documents out of the review entirely
	expect(reviewSystemPrompts[0] ?? '').toContain('## code/architecture/react');
	expect(reviewSystemPrompts[0] ?? '').toContain('## tests/unit-testing-react-components');
});

test('a ledgered site the run measurably worsened still qualifies, and an unchanged one does not', async () => {
	// Two files already past the cap before the run starts, both accepted in the
	// committed debt ledger at the repo root. The run grows one and rewrites the
	// other at exactly the same length.
	const dir = setupConsumerRepo({
		config: { 'standards-checks': { 'size-file': { severity: 'blocking', settings: { file: 6 } } } },
		sources: {
			'src/index.js': 'export const one = 1;\n',
			'src/grown.js': overCapSource({ name: 'grown', note: 'first', pad: 7 }),
			'src/steady.js': overCapSource({ name: 'steady', note: 'first', pad: 7 }),
		},
	});
	writeFileSync(
		join(dir, 'lightsout.standards-baseline.json'),
		JSON.stringify({ at: '2026-01-01T00:00:00.000Z', path: '.', siteKeys: ['size-file:src/grown.js', 'size-file:src/steady.js'] }),
	);
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm ledger', { cwd: dir });
	// the line-count rule reads a parsed tree, so the repo needs a compiler
	linkTypescript({ dir });

	const refactorPrompts: string[] = [];
	const driver = attributionDriver({
		dir,
		testFile: 'test/grown.test.js',
		refactorPrompts,
		implement: () => {
			writeSource({ dir, path: 'src/grown.js', source: overCapSource({ name: 'grown', note: 'first', pad: 29 }) });
			writeSource({ dir, path: 'src/steady.js', source: overCapSource({ name: 'steady', note: 'second', pad: 7 }) });

			return ['src/grown.js', 'src/steady.js'];
		},
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	const cleanup = RefactorStepReport.parse(result.manifest.steps.find((step) => step.id === 'refactor')?.report);
	const remaining = cleanup.remaining.map((finding) => finding.siteKey);

	// the ledger accepted this site and the run made it bigger — the live check
	// has to read past the ledger, or accepted debt could grow unwatched
	expect(refactorPrompts[0] ?? '').toContain('[size-file] src/grown.js');
	expect(remaining).toContain('size-file:src/grown.js');
	// the same rule on a file the run rewrote at the same length is debt it
	// inherited: recorded, never handed back as work
	expect(refactorPrompts[0] ?? '').not.toContain('[size-file] src/steady.js');
	expect(cleanup.inherited.map((finding) => finding.siteKey)).toContain('size-file:src/steady.js');
	expect(remaining).not.toContain('size-file:src/steady.js');
	expect(result.ok).toBe(true);
});

test('a folder finding already in the baseline never gates a change inside the folder', async () => {
	// A folder already past the crowding cap before the run starts. The run
	// edits one file inside it and creates none, so the folder measures exactly
	// what the baseline recorded — the case that used to stop an unattended run.
	const dir = setupConsumerRepo({
		config: { 'standards-checks': { 'crowded-folder': { severity: 'blocking', settings: { cap: 3 } } } },
		sources: {
			'src/index.js': 'export const one = 1;\n',
			'src/pile/alpha.js': 'export const alpha = () => 1;\n',
			'src/pile/beta.js': 'export const beta = () => 2;\n',
		},
	});
	const refactorPrompts: string[] = [];
	const driver = attributionDriver({
		dir,
		testFile: 'test/alpha.test.js',
		refactorPrompts,
		implement: () => {
			// its consumer is already there, so the folder gains no file
			writeSource({ dir, path: 'src/pile/alpha.js', source: 'export const alpha = () => 11;\n' });

			return ['src/pile/alpha.js'];
		},
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	const cleanup = RefactorStepReport.parse(result.manifest.steps.find((step) => step.id === 'refactor')?.report);

	// the folder is in scope because a file under it changed — and that is
	// exactly why it must not be work: the run did not crowd it
	expect(cleanup.inherited.map((finding) => finding.siteKey)).toContain('crowded-folder:src/pile');
	expect(cleanup.remaining).toStrictEqual([]);
	expect(refactorPrompts.every((prompt) => !prompt.includes('[crowded-folder]'))).toBe(true);
	expect(result.ok).toBe(true);
	expect(result.manifest.steps.find((step) => step.id === 'refactor')?.status).toBe('passed');
});

test('a run with no baseline records every finding as uncertain', async () => {
	const dir = setupConsumerRepo();
	const refactorPrompts: string[] = [];
	let reviews = 0;
	const driver = attributionDriver({
		dir,
		testFile: 'test/messy.test.js',
		refactorPrompts,
		onReview: () => {
			reviews += 1;
		},
		implement: () => {
			writeSource({ dir, path: 'src/messy.js', source: 'export const first = () => 1;\nexport const second = () => 2;\n' });

			// what a run created before the baseline existed looks like once it is
			// resumed past clean-slate: the comparison point is simply not there
			const runsDir = join(dir, '.lightsout', 'runs');

			for (const id of readdirSync(runsDir)) {
				rmSync(join(runsDir, id, 'standards-baseline.json'), { force: true });
			}

			return ['src/messy.js'];
		},
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	const cleanup = RefactorStepReport.parse(result.manifest.steps.find((step) => step.id === 'refactor')?.report);

	// no comparison point means no claim about where a finding came from
	expect(cleanup.uncertain.map((finding) => finding.siteKey)).toContain('multi-export:src/messy.js');
	expect(cleanup.remaining).toStrictEqual([]);
	// nothing qualified, so no cleanup agent was ever spent
	expect(refactorPrompts).toStrictEqual([]);
	expect(cleanup.roundsUsed).toBe(0);
	expect(cleanup.endReason).toBe('no-work');
	// provenance is what is missing, not the judgment reviewer's read
	expect(reviews).toBe(1);
	expect(result.ok).toBe(true);
});
