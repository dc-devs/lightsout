import { describe, expect, test } from '@jest/globals';
import { printRunFooter } from '#src/cli/common/render/printRunFooter.ts';
import { type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

const manifestOf = (overrides: Partial<RunManifest> = {}): RunManifest => ({
	runId: 'run-42',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	plan: '',
	harness: 'stub',
	status: RunStatus.Passed,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
	...overrides,
});

describe('printRunFooter', () => {
	test('a run that changed files gets the commit reminder, the evidence path, and the failure on stderr', () => {
		const { logged, errors } = captureCommandOutput();

		printRunFooter({ manifest: manifestOf({ changedFiles: ['a.ts'], status: RunStatus.Failed }), ending: 'gates stayed red after 3 attempts' });

		expect(logged.join('\n')).toContain('1 file(s) changed in the working tree — review and commit; the engine never commits.');
		expect(logged.join('\n')).toContain('evidence: .lightsout/runs/run-42/');
		expect(errors.join('\n')).toContain('gates stayed red after 3 attempts');
	});

	test('a run that paused says how to resume on stdout — it did what it was asked, and stderr reads as a fault', () => {
		const { logged, errors } = captureCommandOutput();

		printRunFooter({
			manifest: manifestOf({ status: RunStatus.PausedBudget }),
			ending: 'paused at --max-batches 2 — resume with: lightsout refactor --run run-42',
		});

		expect(logged.join('\n')).toContain('paused at --max-batches 2 — resume with: lightsout refactor --run run-42');
		expect(errors).toStrictEqual([]);
	});

	test('a rate-limit wall is a pause too, not a failure', () => {
		const { errors } = captureCommandOutput();

		printRunFooter({ manifest: manifestOf({ status: RunStatus.PausedRateLimit }), ending: 'rate limited — resume when the window resets' });

		expect(errors).toStrictEqual([]);
	});

	test('a run that changed nothing skips the commit reminder and stays off stderr', () => {
		const { logged, errors } = captureCommandOutput();

		printRunFooter({ manifest: manifestOf() });

		expect(logged.join('\n')).not.toContain('review and commit');
		expect(logged.join('\n')).toContain('evidence: .lightsout/runs/run-42/');
		expect(errors).toStrictEqual([]);
	});
});
