import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { getProgressLogPath } from '#src/runState/index.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';

/** A repo holding the named runs, each in the folder the command that owns it gives it. */
const setupRuns = ({ runIds }: { runIds: string[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-progress-path-'));

	for (const runId of runIds) {
		mkdirSync(runDirFor({ cwd, runId }), { recursive: true });
	}

	return { cwd };
};

describe('getProgressLogPath', () => {
	test('places the narration beside the run it belongs to', async () => {
		const { cwd } = setupRuns({ runIds: ['run-a', 'run-b'] });

		expect(await getProgressLogPath({ cwd, runId: 'run-a' })).toBe(join(runDirFor({ cwd, runId: 'run-a' }), 'progress.jsonl'));
	});

	test('gives every run its own log, so one run never reads another run’s lines', async () => {
		const { cwd } = setupRuns({ runIds: ['run-a', 'run-b'] });

		const first = await getProgressLogPath({ cwd, runId: 'run-a' });
		const second = await getProgressLogPath({ cwd, runId: 'run-b' });

		expect([first, second]).toStrictEqual([
			join(runDirFor({ cwd, runId: 'run-a' }), 'progress.jsonl'),
			join(runDirFor({ cwd, runId: 'run-b' }), 'progress.jsonl'),
		]);
	});

	test('resolves relative to the given repo, never to the process cwd', async () => {
		const { cwd } = setupRuns({ runIds: ['run-a', 'run-b'] });

		// the answer sits under the repo it was asked about, wherever that is
		expect(await getProgressLogPath({ cwd, runId: 'run-a' })).toBe(join(cwd, '.lightsout', 'implement', 'runs', 'run-a', 'progress.jsonl'));
	});
});
