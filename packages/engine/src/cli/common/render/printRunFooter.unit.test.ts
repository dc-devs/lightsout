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
	...overrides,
});

describe('printRunFooter', () => {
	test('a run that changed files gets the commit reminder, the evidence path, and the error on stderr', () => {
		const { logged, errors } = captureCommandOutput();

		printRunFooter({ manifest: manifestOf({ changedFiles: ['a.ts'] }), error: 'paused at --max-batches 2' });

		expect(logged.join('\n')).toContain('1 file(s) changed in the working tree — review and commit; the engine never commits.');
		expect(logged.join('\n')).toContain('evidence: .lightsout/runs/run-42/');
		expect(errors.join('\n')).toContain('paused at --max-batches 2');
	});

	test('a run that changed nothing skips the commit reminder and stays off stderr', () => {
		const { logged, errors } = captureCommandOutput();

		printRunFooter({ manifest: manifestOf() });

		expect(logged.join('\n')).not.toContain('review and commit');
		expect(logged.join('\n')).toContain('evidence: .lightsout/runs/run-42/');
		expect(errors).toStrictEqual([]);
	});
});
