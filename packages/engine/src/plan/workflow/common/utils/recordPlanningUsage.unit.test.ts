import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { recordPlanningUsage } from '#src/plan/workflow/common/utils/recordPlanningUsage.ts';
import { planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';

const setup = async () => {
	const fixture = await planningStoreFixture();
	const usage = { inputTokens: 100, outputTokens: 25, cacheReadTokens: 50, cacheCreationTokens: 10, costUsd: 0.12 };
	return { ...fixture, usage, local: join(fixture.root, '.planning', 'local') };
};

test('preserves each actual result and distinguishes missing usage from a reported bill', async () => {
	const fixture = await setup();
	const base = { cwd: fixture.cwd, name: fixture.name, workId: 'draft', attemptId: 'attempt', startedAt: 100, endedAt: 150 };

	await recordPlanningUsage({ ...base, result: { text: 'first result', exitCode: 0 } });
	await recordPlanningUsage({ ...base, endedAt: 90, result: { text: 'second result', exitCode: 1, rateLimited: true, usage: fixture.usage } });
	const records = await Promise.all((await readdir(fixture.local)).map(async (path) => JSON.parse(await readFile(join(fixture.local, path), 'utf8'))));

	expect(records).toHaveLength(2);
	expect(new Set(records.map((record) => record.callId)).size).toBe(2);
	expect(records).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ workId: 'draft', attemptId: 'attempt', text: 'first result', elapsedMs: 50, usage: null, exitCode: 0, rateLimited: false }),
			expect.objectContaining({
				workId: 'draft',
				attemptId: 'attempt',
				text: 'second result',
				elapsedMs: 0,
				usage: fixture.usage,
				exitCode: 1,
				rateLimited: true,
			}),
		]),
	);
});
