import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { getRunsDir, resolveRunId, RunNotFoundError } from '@/runState';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

interface SetupParams {
	/** Directory names to create under .lightsout/runs, as a run would leave behind. */
	runIds?: string[];
	/** Plain files to drop beside them — never runs, whatever they are called. */
	files?: string[];
}

const setupRunsDir = ({ runIds = [], files = [] }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const runsDir = getRunsDir({ cwd });

	mkdirSync(runsDir, { recursive: true });

	for (const runId of runIds) {
		mkdirSync(join(runsDir, runId), { recursive: true });
	}

	for (const name of files) {
		writeFileSync(join(runsDir, name), '', 'utf8');
	}

	return { cwd };
};

describe('resolveRunId', () => {
	test('keeps a run id that already names a directory on disk', async () => {
		const { cwd } = setupRunsDir({ runIds: ['be7bc314-1845-44c0-bb6c-a8c2becb7f92'] });

		const runId = await resolveRunId({ cwd, runId: 'be7bc314-1845-44c0-bb6c-a8c2becb7f92' });

		expect(runId).toBe('be7bc314-1845-44c0-bb6c-a8c2becb7f92');
	});

	test('expands the shortened run id a report prints into the full one', async () => {
		const { cwd } = setupRunsDir({ runIds: ['be7bc314-1845-44c0-bb6c-a8c2becb7f92'] });

		// the eight characters printResult shows are what a user copies back
		const runId = await resolveRunId({ cwd, runId: 'be7bc314' });

		expect(runId).toBe('be7bc314-1845-44c0-bb6c-a8c2becb7f92');
	});

	test('picks the one run a prefix matches out of several', async () => {
		const { cwd } = setupRunsDir({ runIds: ['aaaaaaaa-1111', 'bbbbbbbb-2222', 'cccccccc-3333'] });

		const runId = await resolveRunId({ cwd, runId: 'bbbbbbbb' });

		expect(runId).toBe('bbbbbbbb-2222');
	});

	test('prefers the exact directory over a longer one it also prefixes', async () => {
		const { cwd } = setupRunsDir({ runIds: ['abc', 'abcdef'] });

		// 'abc' names a run of its own, so it is an answer rather than a prefix
		const runId = await resolveRunId({ cwd, runId: 'abc' });

		expect(runId).toBe('abc');
	});

	test('names the run id it could not find instead of failing on a path', async () => {
		const { cwd } = setupRunsDir({ runIds: ['aaaaaaaa-1111'] });

		await expect(resolveRunId({ cwd, runId: 'bbbbbbbb' })).rejects.toThrow(RunNotFoundError);
		await expect(resolveRunId({ cwd, runId: 'bbbbbbbb' })).rejects.toThrow(/bbbbbbbb/);
	});

	test('says so plainly when the repo has never held a run', async () => {
		const cwd = setupConsumerRepo({ git: false });

		await expect(resolveRunId({ cwd, runId: 'bbbbbbbb' })).rejects.toThrow(RunNotFoundError);
	});

	test('refuses to guess between runs sharing a prefix, and lists them', async () => {
		const { cwd } = setupRunsDir({ runIds: ['abcd-1111', 'abcd-2222'] });

		await expect(resolveRunId({ cwd, runId: 'abcd' })).rejects.toThrow(RunNotFoundError);
		await expect(resolveRunId({ cwd, runId: 'abcd' })).rejects.toThrow(/abcd-1111.*abcd-2222/);
	});

	test('ignores a stray file whose name would otherwise match', async () => {
		const { cwd } = setupRunsDir({ files: ['abcd-1111'] });

		// only a directory holds a manifest, so a file is never a run
		await expect(resolveRunId({ cwd, runId: 'abcd' })).rejects.toThrow(RunNotFoundError);
	});
});
