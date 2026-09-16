import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { invokePlanningRole, readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { planningClaimedWorkflowFixture } from '#tests/helpers/planningClaimedWorkflowFixture.ts';
import { rejectPlanningLocalWrites } from '#tests/helpers/rejectPlanningLocalWrites.ts';

const saved = async () => {
	const fixture = await planningClaimedWorkflowFixture();
	const result = await invokePlanningRole({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work });
	const local = join(fixture.root, '.planning', 'local');
	const files = (await readdir(local)).filter((path) => path.endsWith('.json'));
	if (files.length !== 1) throw new Error('Expected exactly one real provider diagnostic');
	const path = join(local, files[0]);
	const diagnostic = JSON.parse(await readFile(path, 'utf8'));
	return { ...fixture, result, path, diagnostic };
};

test.each(['invocation', 'packet', 'envelope-attempt', 'envelope-work', 'result-attempt', 'result-work', 'nonterminal'])(
	'does not grant recovery authority to a mismatched saved response: %s',
	async (variant) => {
		const fixture = await saved();
		const response = JSON.parse(fixture.diagnostic.text);
		if (variant === 'invocation') response.invocationId = 'foreign-invocation';
		if (variant === 'packet') response.packetDigest = 'a'.repeat(64);
		if (variant === 'envelope-attempt') fixture.diagnostic.attemptId = 'foreign-attempt';
		if (variant === 'envelope-work') fixture.diagnostic.workId = 'foreign-work';
		if (variant === 'result-attempt') response.attemptId = 'foreign-attempt';
		if (variant === 'result-work') response.workId = 'foreign-work';
		if (variant === 'nonterminal') {
			response.kind = 'evidence-request';
			delete response.claims;
			delete response.evidence;
			delete response.work;
			delete response.findings;
			delete response.dependencies;
			response.requests = [{ requestId: 'missing', operation: 'read-file', path: 'package.json', reason: 'Inspect source' }];
		}
		fixture.diagnostic.text = JSON.stringify(response);
		await writeFile(fixture.path, JSON.stringify(fixture.diagnostic));
		fixture.expire();
		const calls: string[] = [];
		fixture.runtime.driver = {
			...fixture.runtime.driver,
			invoke: async (invocation) => {
				calls.push(invocation.prompt);
				return { text: 'No capacity for replacement attempt', exitCode: 1, rateLimited: true };
			},
		};
		const result = await runPlanning({ runtime: fixture.runtime });
		const snapshot = await readPlanningSnapshot(fixture);
		expect(result.status).toBe('externally-blocked');
		expect(calls).toHaveLength(1);
		expect(snapshot?.record.work.find((work) => work.id === fixture.work.id)).toEqual(expect.objectContaining({ status: 'interrupted', attemptSequence: 2 }));
		expect(snapshot?.record.work.find((work) => work.id === fixture.work.id)?.resultReceiptId).toBeUndefined();
		expect(snapshot?.record.reviewReceipts).toStrictEqual([]);
		expect(await readFile(fixture.path, 'utf8')).toBe(JSON.stringify(fixture.diagnostic));
	},
);

test('waits for a live owner rather than recovering its unfinished publication', async () => {
	const fixture = await saved();
	const running = runPlanning({ runtime: fixture.runtime });
	await new Promise((resolve) => setTimeout(resolve, 300));
	const during = await readPlanningSnapshot(fixture);
	expect(during?.record.work.find((work) => work.id === fixture.work.id)?.status).toBe('running');
	expect(fixture.calls).toHaveLength(1);
	fixture.expire();
	const result = await running;
	const after = await readPlanningSnapshot(fixture);
	expect(result.status).toBe('complete');
	expect(after?.record.work.find((work) => work.id === fixture.work.id)?.currentAttemptId).toBe(fixture.result.attemptId);
	expect(fixture.calls.filter((call) => call.prompt.includes('"role":"investigate"'))).toHaveLength(1);
});

const unavailable = async ({ limited = false } = {}) => {
	const fixture = await planningClaimedWorkflowFixture({
		respond: async ({ response }) => ({ text: JSON.stringify(response), exitCode: limited ? 1 : 0, rateLimited: limited }),
	});
	const fault = await rejectPlanningLocalWrites(fixture);
	return { ...fixture, ...fault };
};

test('retains a paid output across repeated persistence failures without another invocation', async () => {
	const fixture = await unavailable();
	await expect(invokePlanningRole({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work })).rejects.toMatchObject({
		preserveAttempt: true,
	});
	const retained = fixture.runtime.pendingOutput;
	const result = await runPlanning({ runtime: fixture.runtime });
	expect(result).toEqual(expect.objectContaining({ status: 'externally-blocked', cause: expect.stringContaining('persistence') }));
	expect(fixture.runtime.pendingOutput).toBe(retained);
	expect(fixture.failures()).toBeGreaterThan(1);
	expect(fixture.calls).toHaveLength(1);
	expect((await readPlanningSnapshot(fixture))?.record.work.find((work) => work.id === fixture.work.id)?.status).toBe('running');
	await fixture.restore();
});

test('persists a retained rate-limited response but cannot accept its terminal-looking content', async () => {
	const fixture = await unavailable({ limited: true });
	await expect(invokePlanningRole({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work })).rejects.toMatchObject({
		preserveAttempt: true,
	});
	await fixture.restore();
	const result = await runPlanning({ runtime: fixture.runtime });
	const snapshot = await readPlanningSnapshot(fixture);
	expect(result).toEqual(expect.objectContaining({ status: 'externally-blocked', cause: expect.stringContaining('rate limited') }));
	expect(fixture.calls).toHaveLength(1);
	expect(fixture.runtime.pendingOutput).toBeUndefined();
	expect(snapshot?.record.work.find((work) => work.id === fixture.work.id)).toEqual(expect.objectContaining({ status: 'interrupted' }));
	expect(snapshot?.record.work.find((work) => work.id === fixture.work.id)?.resultReceiptId).toBeUndefined();
	expect(snapshot?.record.reviewReceipts).toStrictEqual([]);
});
