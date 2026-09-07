import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { AcceptanceTestRecord, LightsoutConfig, RunManifest } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { reviewTestChanges } from '#src/pipeline/approvedTests/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const runId = 'run-1';
const checkpoint = 'verify-tests';
const testFile = 'src/widget.unit.test.js';
const criterion = 'the widget renders its label';

/** What the repo carries at HEAD — the approved version of the test file. */
const committed = "test('widget: renders', () => {\n\texpect(label()).toBe('on');\n});\n";

/**
 * The same case under the same title, with one assertion added. Different bytes,
 * so the checkpoint bundles the file; same title, so the only thing that can go
 * wrong is the disposition itself rather than the locator.
 */
const sharpened = "test('widget: renders', () => {\n\texpect(label()).toBe('on');\n\texpect(label()).not.toBe('');\n});\n";

const acceptanceRow: AcceptanceTestRecord = { criterion, testFile, testName: 'widget: renders', gate: 'test' };

/** A reviewer stub: one spawn, one verdict object. */
const createReviewerDriver = ({ verdicts }: { verdicts: unknown[] }): Driver => ({
	name: 'stub',
	invoke: async () => ({ text: JSON.stringify({ verdicts }), exitCode: 0 }),
});

/** An approve verdict for the bundled file, carrying the dispositions under test. */
const approveWith = ({ dispositions }: { dispositions: Record<string, unknown>[] }) => [
	{ path: testFile, decision: 'approve', reason: 'the plan sharpens what this case asserts', acceptanceTests: dispositions },
];

/** The run's review journal, one parsed record per line. */
const readJournal = ({ cwd }: { cwd: string }) => {
	const path = join(cwd, '.lightsout', 'runs', runId, 'test-reviews.jsonl');

	if (!existsSync(path)) {
		return [];
	}

	return readFileSync(path, 'utf8')
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
};

/** Where the run keeps its approved copy of the bundled test file. */
const approvedCopy = ({ cwd }: { cwd: string }) => join(cwd, '.lightsout', 'runs', runId, 'approved', testFile);

interface SetupParams {
	/** What the stub reviewer returns. */
	verdicts: unknown[];
	/** The live acceptance-test mapping the manifest carries. */
	acceptanceTests?: AcceptanceTestRecord[];
}

const setupReview = ({ verdicts, acceptanceTests = [acceptanceRow] }: SetupParams) => {
	const cwd = setupConsumerRepo({ sources: { 'src/index.js': 'export const one = 1;\n', [testFile]: committed } });

	writeFileSync(join(cwd, testFile), sharpened);

	const manifest = { runId, changedFiles: [testFile], packages: [], baselineDirtyFiles: [], acceptanceTests, approvedTests: [] } as unknown as RunManifest;

	const run = {
		cwd,
		driver: createReviewerDriver({ verdicts }),
		config: { gates: { check: 'true', test: 'true' } } as unknown as LightsoutConfig,
		current: () => manifest,
		progress: () => {},
		update: async ({ patch }: { patch: Partial<RunManifest> }) => {
			Object.assign(manifest, patch);
		},
		recordUsage: async () => {},
		agentEventSink: () => () => {},
		persistRejected: () => async () => {},
	};

	return { run: run as unknown as PipelineRun, cwd, manifest };
};

/**
 * The same checkpoint in a directory that is not a git worktree: nothing to read
 * a committed baseline from, and no `git status` to say what changed. The
 * reviewer's spawns are counted, so a bundle the checkpoint never assembled is
 * distinguishable from one it assembled and judged.
 */
const setupUntrackedReview = ({ verdicts }: { verdicts: unknown[] }) => {
	const cwd = setupConsumerRepo({ git: false, sources: { 'src/index.js': 'export const one = 1;\n', [testFile]: committed } });
	const spawns: string[] = [];
	const manifest = {
		runId,
		changedFiles: [testFile],
		packages: [],
		baselineDirtyFiles: [],
		acceptanceTests: [acceptanceRow],
		approvedTests: [],
	} as unknown as RunManifest;

	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			spawns.push('reviewer');

			return { text: JSON.stringify({ verdicts }), exitCode: 0 };
		},
	};

	const run = {
		cwd,
		driver,
		config: { gates: { check: 'true', test: 'true' } } as unknown as LightsoutConfig,
		current: () => manifest,
		progress: () => {},
		update: async ({ patch }: { patch: Partial<RunManifest> }) => {
			Object.assign(manifest, patch);
		},
		recordUsage: async () => {},
		agentEventSink: () => () => {},
		persistRejected: () => async () => {},
	};

	return { run: run as unknown as PipelineRun, cwd, manifest, spawns };
};

describe('reviewTestChanges', () => {
	test.each([
		{
			label: 'a rename that names no new title',
			disposition: { testName: 'widget: renders', disposition: 'renamed' },
			expected: 'the `renamed` disposition for `widget: renders` names no newTestName',
		},
		{
			label: 'a move that names no destination file',
			disposition: { testName: 'widget: renders', disposition: 'moved' },
			expected: 'the `moved` disposition for `widget: renders` names no testFile',
		},
		{
			label: 'a replacement that names neither',
			disposition: { testName: 'widget: renders', disposition: 'replaced' },
			expected: 'the `replaced` disposition for `widget: renders` names no newTestName and no testFile',
		},
	])('reviewTestChanges: $label refuses the checkpoint and leaves the mapping row where it was', async ({ disposition, expected }) => {
		const { run, cwd, manifest } = setupReview({ verdicts: approveWith({ dispositions: [disposition] }) });

		const result = await reviewTestChanges({ run, checkpoint, planContent: '# Plan' });

		// the engine cannot follow a disposition that does not say where the test
		// went, so the approval it rode on buys the file nothing
		expect(String(result.error)).toContain(expected);
		expect(manifest.approvedTests).toStrictEqual([]);
		expect(existsSync(approvedCopy({ cwd }))).toBe(false);
		// the row stays exactly as the mapping stated it — a disposition the engine
		// refused must not half-move the test it could not place
		expect(manifest.acceptanceTests).toStrictEqual([acceptanceRow]);
	});

	test('reviewTestChanges: an acceptance test whose file the engine cannot read refuses the checkpoint', async () => {
		const missingRow: AcceptanceTestRecord = {
			criterion: 'the widget hides when it has no label',
			testFile: 'src/gone.unit.test.js',
			testName: 'widget: hides when empty',
			gate: 'test',
		};
		const { run, manifest } = setupReview({ verdicts: approveWith({ dispositions: [] }), acceptanceTests: [acceptanceRow, missingRow] });

		const result = await reviewTestChanges({ run, checkpoint, planContent: '# Plan' });

		const error = String(result.error);

		// a mapping row whose file is not on disk proves nothing, which is the same
		// answer as a file that no longer states the test
		expect(error).toContain('src/gone.unit.test.js');
		expect(error).toContain('widget: hides when empty');
		expect(error).toContain('the widget hides when it has no label');
		// the row that is still stated does not drag the checkpoint red with it
		expect(error).not.toContain('widget: renders`');
		expect(manifest.approvedTests).toStrictEqual([]);
	});

	test('reviewTestChanges: a refusal of a file holding no acceptance test names the file and the reason alone', async () => {
		const { run, cwd, manifest } = setupReview({
			verdicts: [{ path: testFile, decision: 'reject', reason: 'the mock now returns the value the subject was meant to compute', acceptanceTests: [] }],
			acceptanceTests: [],
		});

		const result = await reviewTestChanges({ run, checkpoint, planContent: '# Plan' });

		const error = String(result.error);

		expect(error).toContain(testFile);
		expect(error).toContain('the mock now returns the value the subject was meant to compute');
		// no ledger row rides on this file, so the refusal carries no list of tests
		// for the fix role to chase
		expect(error).not.toContain('acceptance tests stated in this file');
		expect(manifest.approvedTests).toStrictEqual([]);
		expect(existsSync(approvedCopy({ cwd }))).toBe(false);
		// a refused checkpoint is journalled too, carrying the line it went red on
		expect(readJournal({ cwd })[0]).toEqual(expect.objectContaining({ checkpoint, rejections: [expect.stringContaining(testFile)] }));
	});

	test('reviewTestChanges: outside a git worktree the manifest alone puts the changed test file in front of the reviewer', async () => {
		const { run, cwd, manifest, spawns } = setupUntrackedReview({
			verdicts: [
				{
					path: testFile,
					decision: 'approve',
					reason: 'the plan adds this file, and the case it states is the one the ledger names',
					acceptanceTests: [{ testName: 'widget: renders', disposition: 'kept' }],
				},
			],
		});

		const result = await reviewTestChanges({ run, checkpoint, planContent: '# Plan' });

		// With no history to read, a file the run says it changed has no approved
		// version at all, so the whole of it goes to the reviewer as an addition
		// rather than the checkpoint quietly waving it through.
		expect(spawns).toStrictEqual(['reviewer']);
		expect(result.error).toBe(undefined);
		// and the approval still moves the baseline: the copy is what the next
		// checkpoint diffs against, which is the only baseline available here
		expect(readFileSync(approvedCopy({ cwd }), 'utf8')).toBe(committed);
		expect(manifest.approvedTests.map(({ path, removed }) => ({ path, removed }))).toStrictEqual([{ path: testFile, removed: false }]);
		expect(manifest.acceptanceTests).toStrictEqual([acceptanceRow]);
	});
});
