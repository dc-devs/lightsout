import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { StandardsSnapshot } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { runStandardsCheck } from '#src/standardsCheck/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/**
 * A consumer repo whose gates behave as `scripts` says, driven by a stub that
 * implements one source file and drops one stub test per writer. `spawned`
 * records agent roles — clean-slate's contract is that a red baseline buys
 * none of them.
 */
const setupCleanSlateRun = async ({
	scripts,
	config,
	sources,
}: {
	scripts: Record<string, string | false>;
	config?: Record<string, unknown>;
	/** Source files the repo carries from its first commit — pre-existing debt, not this run's doing. */
	sources?: Record<string, string>;
}) => {
	const dir = setupConsumerRepo({ scripts, config, sources });
	const spawned: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				const role = roleOf(prompt);

				if (role === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				spawned.push(role);

				if (role === 'write-tests') {
					mkdirSync(join(dir, 'test'), { recursive: true });
					writeFileSync(join(dir, 'test/feature.test.js'), '// stub test\n');

					return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
				}

				writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			},
		}),
	};

	return { dir, driver, spawned, config: await readConfig({ cwd: dir }) };
};

/** Where one run keeps the deterministic findings from before its first agent edit. */
const baselinePathOf = ({ dir, runId }: { dir: string; runId: string }) => join(dir, '.lightsout', 'runs', runId, 'standards-baseline.json');

test('clean-slate: a red baseline gate fails the run before a single agent is spawned', async () => {
	const { dir, driver, spawned, config } = await setupCleanSlateRun({ scripts: { check: 'echo BASELINE-SENTINEL >&2; exit 1' } });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/Codebase is not green before implementation — fix this first\./);
	// the gate output travels with the verdict
	expect(result.error ?? '').toMatch(/BASELINE-SENTINEL/);
	expect(result.manifest.steps.find((step) => step.id === 'clean-slate')?.status).toBe('failed');
	// the run never reached implement
	expect(result.manifest.steps.find((step) => step.id === 'implement')).toBe(undefined);
	// a red baseline costs no agent turn to learn
	expect(spawned).toStrictEqual([]);
});

test('clean-slate: a gate that ran out of time is reported as a gate that did not finish, not as a red codebase', async () => {
	// The two want different first moves from a human — raise the ceiling or free
	// the machine, versus fix the code — and a suite killed at its ceiling is
	// green as far as anyone knows.
	const { dir, driver, config } = await setupCleanSlateRun({
		scripts: { check: 'sleep 5' },
		config: { timeouts: { 'gate-minutes': 0.02 } },
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/did not finish, so the codebase was never proved green/);
	expect(result.error ?? '').not.toMatch(/Codebase is not green before implementation/);
});

test('clean-slate: artifacts left behind by a gate command fold into the baseline, never the changed files', async () => {
	const { dir, driver, config } = await setupCleanSlateRun({
		scripts: { check: `node -e "require('fs').appendFileSync('gate-artifact.log','x')"` },
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

	expect(result.ok).toBe(true);
	// the artifact folded into the baseline at clean-slate
	expect(result.manifest.baselineDirtyFiles.includes('gate-artifact.log')).toBeTruthy();
	// and is never attributed to the agents
	expect(result.manifest.changedFiles.includes('gate-artifact.log')).toBeFalsy();
	// real agent work is still attributed
	expect(result.manifest.changedFiles.includes('src/feature.js')).toBeTruthy();
	expect(result.manifest.steps.find((step) => step.id === 'clean-slate')?.status).toBe('passed');
});

test('clean-slate: a passing baseline writes the pre-edit standards baseline into the run folder', async () => {
	const { dir, driver, config } = await setupCleanSlateRun({ scripts: {} });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	const baseline = StandardsSnapshot.safeParse(JSON.parse(readFileSync(baselinePathOf({ dir, runId: result.manifest.runId }), 'utf8')));

	expect(result.manifest.steps.find((step) => step.id === 'clean-slate')?.status).toBe('passed');
	// what cleanup later compares against has to parse as the contract it reads
	expect(baseline.success).toBe(true);
	// the whole repository, not the run's own subpath — inherited debt anywhere
	// has to be tellable from debt this run made
	expect(baseline.data?.path).toBe('.');
});

test('clean-slate: the baseline is captured even when the run skips refactor', async () => {
	const { dir, driver, config } = await setupCleanSlateRun({ scripts: {} });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

	const baseline = StandardsSnapshot.safeParse(JSON.parse(readFileSync(baselinePathOf({ dir, runId: result.manifest.runId }), 'utf8')));

	expect(result.ok).toBe(true);
	// a resume that does not skip cleanup still needs the pre-edit state, and
	// this run is the only moment it can be read
	expect(baseline.success).toBe(true);
});

test('clean-slate: a red baseline gate writes no standards baseline', async () => {
	const { dir, driver, config } = await setupCleanSlateRun({ scripts: { check: 'exit 1' } });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.steps.find((step) => step.id === 'clean-slate')?.status).toBe('failed');
	// the capture sits after the gates, so a run that never starts spends
	// nothing on a whole-repo check
	expect(existsSync(baselinePathOf({ dir, runId: result.manifest.runId }))).toBe(false);
});

test('clean-slate: a standards pack that cannot load leaves no baseline and does not fail the run', async () => {
	// The capture reads the repo's config off disk itself, so a config file
	// naming a pack root that is not there is what makes it throw. The run is
	// handed standards switched off instead, because every earlier step
	// resolves the packs in the config it was given and would stop the run
	// before clean-slate ever ran.
	const { dir, driver, config } = await setupCleanSlateRun({ scripts: {}, config: { 'standards-packs': ['standards/ghost'] } });
	const progress: string[] = [];

	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: { ...config, 'standards-packs': false },
		planPath: 'plan.md',
		skipRefactor: true,
		onProgress: (message) => progress.push(message),
	});

	// evidence only optional cleanup reads must never stop a run
	expect(result.ok).toBe(true);
	expect(result.manifest.steps.find((step) => step.id === 'clean-slate')?.status).toBe('passed');
	expect(existsSync(baselinePathOf({ dir, runId: result.manifest.runId }))).toBe(false);
	// and the reader is told what failed, not left to wonder why cleanup has no
	// comparison point
	expect(progress.join('\n')).toMatch(/standards pack root file not found/);
});

test('clean-slate: standards explicitly off still writes a baseline with no findings', async () => {
	const { dir, driver, config } = await setupCleanSlateRun({ scripts: {}, config: { 'standards-packs': false } });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

	const baseline = StandardsSnapshot.safeParse(JSON.parse(readFileSync(baselinePathOf({ dir, runId: result.manifest.runId }), 'utf8')));

	// "nothing was found" and "no comparison point" are different answers, and
	// an absent file would say the second when the first is true
	expect(baseline.success).toBe(true);
	expect(baseline.data?.findings).toStrictEqual([]);
});

test('clean-slate: a finding the repo already accepted as debt still lands in the baseline', async () => {
	// One committed multi-export violation, then the debt ledger that accepts it
	// — the state of any repo that has run `lightsout standards-check
	// --baseline`. The capture reads past the ledger on purpose: a violation the
	// ledger hides today still has to read as inherited tomorrow, when an edit
	// by this run's own agents makes it visible again.
	const { dir, driver, config } = await setupCleanSlateRun({
		scripts: {},
		sources: { 'src/index.js': 'export const one = 1;\n', 'src/messy.js': 'export const first = () => 1;\nexport const second = () => 2;\n' },
	});

	await runStandardsCheck({ cwd: dir, persist: false, writeBaseline: true });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });
	const baseline = StandardsSnapshot.safeParse(JSON.parse(readFileSync(baselinePathOf({ dir, runId: result.manifest.runId }), 'utf8')));
	const ledgered = (baseline.data?.findings ?? []).filter((finding) => finding.rule === 'multi-export');

	expect(result.ok).toBe(true);
	expect(ledgered.map((finding) => finding.files[0]?.path)).toStrictEqual(['src/messy.js']);
});

test('clean-slate: the capture never clobbers the standalone standards report the user wrote', async () => {
	const { dir, driver, config } = await setupCleanSlateRun({ scripts: {} });
	// what the user's own `lightsout standards-check` left behind
	const standalonePath = join(dir, '.lightsout', 'standards-check.json');

	mkdirSync(join(dir, '.lightsout'), { recursive: true });
	writeFileSync(standalonePath, 'STANDALONE-REPORT-SENTINEL\n');

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

	expect(result.ok).toBe(true);
	// the run writes its comparison point into its own folder and nowhere else
	expect(existsSync(baselinePathOf({ dir, runId: result.manifest.runId }))).toBe(true);
	expect(readFileSync(standalonePath, 'utf8')).toBe('STANDALONE-REPORT-SENTINEL\n');
});
