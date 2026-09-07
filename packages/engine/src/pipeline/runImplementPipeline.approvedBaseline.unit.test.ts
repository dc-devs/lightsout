import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { Permissions } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { reachabilityRulesOff, setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/** A committed test file, and the edit sitting on top of it before the run starts. */
const dirtyTestFile = 'src/widget.unit.test.js';
const committedTestBody = "test('widget: doubles its input', () => {});\n";
const dirtyTestBody = "test('widget: doubles its input', () => { /* PRE-RUN-DIRT */ });\n";

/** Dirt that is not test code, so nothing about it is the reviewer's business. */
const dirtyNoteFile = 'notes.md';

/**
 * The two rules asking where a test file sits are off: this fixture plants a
 * test file to make the working tree dirty, and a run stopped on where that
 * file sits never reaches the question the test asks.
 */
const dirtyBaselineConfig = {
	'standards-checks': { ...reachabilityRulesOff['standards-checks'], 'test-in-tests-folder': 'off', 'test-not-beside-subject': 'off' },
};

/** Every test-file path a prompt names, however the prompt lays them out. */
const testPathsIn = (prompt: string): string[] => [
	...new Set([...prompt.matchAll(/(?:[\w.-]+\/)*[\w.-]+\.(?:test|spec)\.[cm]?[jt]sx?/g)].map(([path]) => path)),
];

/**
 * A consumer repo whose working tree is already dirty when the run starts: a
 * committed test file carrying an uncommitted edit, and an untracked note.
 * Neither was written by an agent — both predate the first agent turn.
 *
 * The stub answers every seat of a full run, the test-change reviewer included.
 * It approves each test file the bundle names rather than a fixed list, so a
 * file it was never meant to see arrives as an approval this test can still
 * catch: `reviewPrompts` records what the reviewer was asked about.
 */
const setupDirtyBaselineRun = async () => {
	const dir = setupConsumerRepo({
		sources: { 'src/widget.js': 'export const widget = (n) => n * 2;\n', [dirtyTestFile]: committedTestBody },
		config: dirtyBaselineConfig,
	});

	writeFileSync(join(dir, dirtyTestFile), dirtyTestBody);
	writeFileSync(join(dir, dirtyNoteFile), 'scratch notes\n');

	const reviewPrompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, permissions }) => {
			const role = roleOf(prompt);

			// The reviewer is the third read-only seat. The supervisor and the
			// standards reviewer each name themselves in a heading of their own, so
			// a read-only invocation matching neither is this one.
			if (permissions === Permissions.ReadOnly && role === 'implement') {
				reviewPrompts.push(prompt);

				const verdicts = testPathsIn(prompt).map((path) => ({ path, decision: 'approve', reason: 'the plan asks for this test file' }));

				return { text: JSON.stringify({ verdicts }), exitCode: 0 };
			}

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub test\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, reviewPrompts, config: await readConfig({ cwd: dir }) };
};

test('clean-slate: test-side dirt that predates the run is approved, so no later checkpoint blames an agent for it', async () => {
	const { dir, driver, reviewPrompts, config } = await setupDirtyBaselineRun();

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

	// the copy itself is gone once the run passes — the record's hash is what
	// proves which bytes were approved
	expect({
		passed: result.ok,
		// the approved version of the dirty test file is the state the run started
		// from — not the content at HEAD, which no checkpoint ever saw
		approvedRecord: result.manifest.approvedTests.find((record) => record.path === dirtyTestFile),
		// approval at clean-slate covers test-side paths only; the note is baseline
		// dirt too, and the reviewer judges no such file
		noteApproved: result.manifest.approvedTests.some((record) => record.path === dirtyNoteFile),
		// it is baseline, so it is never attributed to an agent
		inBaseline: result.manifest.baselineDirtyFiles.includes(dirtyTestFile),
		attributedToAnAgent: result.manifest.changedFiles.includes(dirtyTestFile),
		// and no later checkpoint ever put it in front of the reviewer, which is
		// what an unapproved baseline would have done at the first one
		namedToTheReviewer: reviewPrompts.some((prompt) => prompt.includes(dirtyTestFile)),
		// the reviewer did run on this repo, so that silence is an answer rather
		// than a review that never happened
		reviewerRan: reviewPrompts.length > 0,
	}).toEqual({
		passed: true,
		approvedRecord: expect.objectContaining({ path: dirtyTestFile, sha256: sha256({ content: dirtyTestBody }), removed: false }),
		noteApproved: false,
		inBaseline: true,
		attributedToAnAgent: false,
		namedToTheReviewer: false,
		reviewerRan: true,
	});
});
