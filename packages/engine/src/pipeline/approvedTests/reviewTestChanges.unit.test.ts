import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { AcceptanceTestRecord, LightsoutConfig, RunManifest } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { reviewTestChanges } from '#src/pipeline/approvedTests/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { createOffContractDriver } from '#tests/helpers/createOffContractDriver.ts';
import { createRateLimitedDriver } from '#tests/helpers/createRateLimitedDriver.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const runId = 'run-1';
const checkpoint = 'verify-tests';
const testFile = 'src/widget.unit.test.js';
const criterion = 'the widget renders its label';

/** What the repo carries at HEAD: the approved version of the ledger test file. */
const committed = "test('widget: renders', () => {\n\texpect(label()).toBe('on');\n});\n";
/** The same case with its assertion gutted — what a reviewer refuses. */
const weakened = "test('widget: renders', () => {\n\texpect(label()).toBeDefined();\n});\n";
/** The same assertion under a new title — what an approved rename produces. */
const renamed = "test('widget: renders its label', () => {\n\texpect(label()).toBe('on');\n});\n";

const acceptanceRow: AcceptanceTestRecord = { criterion, testFile, testName: 'widget: renders', gate: 'test' };

/** A reviewer stub: one spawn, one verdict object, every invocation recorded. */
const createReviewerDriver = ({ verdicts, invocations = [] }: { verdicts: unknown[]; invocations?: DriverInvocation[] }): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		return { text: JSON.stringify({ verdicts }), exitCode: 0 };
	},
});

/**
 * A PipelineRun stub over a real git repo holding one committed test file.
 * `live` is what the working tree carries when the checkpoint arrives; leaving
 * it out is a tree that still matches HEAD, and so an empty bundle.
 */
const setupReviewRun = ({ driver, live, acceptanceTests = [] }: { driver: Driver; live?: string; acceptanceTests?: AcceptanceTestRecord[] }) => {
	const cwd = setupConsumerRepo({ sources: { 'src/index.js': 'export const one = 1;\n', [testFile]: committed } });

	if (live !== undefined) {
		writeFileSync(join(cwd, testFile), live);
	}

	const manifest = {
		runId,
		changedFiles: live === undefined ? [] : [testFile],
		packages: [],
		baselineDirtyFiles: [],
		acceptanceTests,
		approvedTests: [],
	} as unknown as RunManifest;

	const progress: string[] = [];
	const usageSteps: string[] = [];

	const run = {
		cwd,
		driver,
		config: { gates: { check: 'true', test: 'true' } } as unknown as LightsoutConfig,
		current: () => manifest,
		progress: (message: string) => progress.push(message),
		update: async ({ patch }: { patch: Partial<RunManifest> }) => {
			Object.assign(manifest, patch);
		},
		recordUsage: async ({ step }: { step: string }) => {
			usageSteps.push(step);
		},
		agentEventSink: () => () => {},
		persistRejected: () => async () => {},
	};

	return { run: run as unknown as PipelineRun, cwd, manifest, progress, usageSteps };
};

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

/** Where the run keeps its approved copy of the ledger test file. */
const approvedCopy = ({ cwd }: { cwd: string }) => join(cwd, '.lightsout', 'runs', runId, 'approved', testFile);

describe('reviewTestChanges', () => {
	test('reviewTestChanges: an empty bundle invokes no reviewer and returns no error', async () => {
		const invocations: DriverInvocation[] = [];
		const { run, cwd } = setupReviewRun({ driver: createReviewerDriver({ verdicts: [], invocations }), acceptanceTests: [acceptanceRow] });

		const result = await reviewTestChanges({ run, checkpoint, planContent: '# Plan' });

		// nothing differs from the approved baseline, so the checkpoint spends no agent
		expect(invocations.length).toBe(0);
		expect(result.error).toBe(undefined);
		expect(result.rateLimited).toBeFalsy();
		expect(readJournal({ cwd })).toStrictEqual([]);
	});

	test('reviewTestChanges: a clean review records the approved copies, the mapping and one journal line', async () => {
		const { run, cwd, manifest } = setupReviewRun({
			driver: createReviewerDriver({
				verdicts: [
					{
						path: testFile,
						decision: 'approve',
						reason: 'the plan renames the case, and the assertion is unchanged',
						acceptanceTests: [{ testName: 'widget: renders', disposition: 'renamed', newTestName: 'widget: renders its label' }],
					},
				],
			}),
			live: renamed,
			acceptanceTests: [acceptanceRow],
		});

		const result = await reviewTestChanges({ run, checkpoint, planContent: '# Plan' });

		expect(result.error).toBe(undefined);
		// the live file becomes the new baseline, copy and hash together
		expect(manifest.approvedTests).toStrictEqual([{ path: testFile, sha256: sha256({ content: renamed }), removed: false }]);
		expect(readFileSync(approvedCopy({ cwd }), 'utf8')).toBe(renamed);
		// the row is proven under the name it now carries; its criterion and gate stand
		expect(manifest.acceptanceTests).toStrictEqual([{ criterion, testFile, testName: 'widget: renders its label', gate: 'test' }]);
		expect(readJournal({ cwd }).length).toBe(1);
		expect(readJournal({ cwd })[0]).toEqual(expect.objectContaining({ checkpoint, rejections: [] }));
	});

	test('reviewTestChanges: a rejection names every refused file and leaves the manifest baseline untouched', async () => {
		const { run, cwd, manifest } = setupReviewRun({
			driver: createReviewerDriver({
				verdicts: [{ path: testFile, decision: 'reject', reason: 'the assertion was weakened to toBeDefined', acceptanceTests: [] }],
			}),
			live: weakened,
			acceptanceTests: [acceptanceRow],
		});

		const result = await reviewTestChanges({ run, checkpoint, planContent: '# Plan' });

		// the checkpoint goes red naming the file the reviewer refused
		expect(result.error).toEqual(expect.stringContaining(testFile));
		expect(result.rateLimited).toBeFalsy();
		// nothing is approved on a refused checkpoint: the next attempt re-reviews the same bundle
		expect(manifest.approvedTests).toStrictEqual([]);
		expect(manifest.acceptanceTests).toStrictEqual([acceptanceRow]);
		expect(existsSync(approvedCopy({ cwd }))).toBe(false);
	});

	test('reviewTestChanges: a reviewer that returns no verdict fails the checkpoint', async () => {
		const { run, cwd, manifest } = setupReviewRun({
			driver: createOffContractDriver({ text: 'I had a look and it all seems fine to me.' }),
			live: weakened,
			acceptanceTests: [acceptanceRow],
		});

		const result = await reviewTestChanges({ run, checkpoint, planContent: '# Plan' });

		// a judge that did not answer is the same red as a judge that said no
		expect(result.error).toEqual(expect.any(String));
		expect(result.rateLimited).toBeFalsy();
		expect(manifest.approvedTests).toStrictEqual([]);
		expect(existsSync(approvedCopy({ cwd }))).toBe(false);
	});

	test('reviewTestChanges: a rate-limited reviewer asks for a park, not a rejection', async () => {
		const { run, manifest } = setupReviewRun({
			driver: createRateLimitedDriver(),
			live: weakened,
			acceptanceTests: [acceptanceRow],
		});

		const result = await reviewTestChanges({ run, checkpoint, planContent: '# Plan' });

		// the run pauses and resumes against the same baseline, rather than blaming the executor
		expect(result.rateLimited).toBe(true);
		expect(result.error).toBe(undefined);
		expect(manifest.approvedTests).toStrictEqual([]);
	});
});
