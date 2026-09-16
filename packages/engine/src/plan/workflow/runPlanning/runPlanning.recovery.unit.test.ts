import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { invokePlanningRole, readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { planningClaimedWorkflowFixture } from '#tests/helpers/planningClaimedWorkflowFixture.ts';
import { readPlanningWorkflowDiagnostics } from '#tests/helpers/readPlanningWorkflowDiagnostics.ts';

const setupSaved = async ({ invalid = false, rateLimited = false } = {}) => {
	const fixture = await planningClaimedWorkflowFixture({
		respond: async ({ response, snapshot }) => {
			if (response.kind !== 'terminal' || response.role !== 'investigate') return response;
			const original = snapshot.record.claims[0];
			if (!original) throw new Error('Missing fixture requirement');
			const result = invalid ? { ...response, claims: [{ ...original, owner: PlanningVocabulary.Owner.Planner, confirmationId: undefined }] } : response;
			return { text: JSON.stringify(result), exitCode: 0, rateLimited };
		},
	});
	return fixture;
};

test('recovers a saved terminal past unrelated truncated local data without repeating the paid investigation', async () => {
	const fixture = await setupSaved();
	const proposed = await invokePlanningRole({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work });
	await writeFile(join(fixture.root, '.planning', 'local', 'truncated.json'), '{"incomplete":');
	fixture.expire();

	const result = await runPlanning({ runtime: fixture.runtime });
	const snapshot = await readPlanningSnapshot(fixture);

	expect(result.status).toBe('complete');
	expect(snapshot?.record.work.find((work) => work.id === fixture.work.id)).toEqual(
		expect.objectContaining({ currentAttemptId: proposed.attemptId, status: 'complete', attemptSequence: 1 }),
	);
	expect(fixture.calls.filter((call) => call.prompt.includes('"role":"investigate"'))).toHaveLength(1);
});

test('diagnoses an invalid saved semantic proposal instead of poisoning every later resume', async () => {
	const fixture = await setupSaved({ invalid: true });
	await invokePlanningRole({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work });
	fixture.expire();
	fixture.runtime.driver = { name: 'claude-code', invoke: async () => ({ text: 'Quota unavailable during diagnosis', rateLimited: true, exitCode: 1 }) };

	const result = await runPlanning({ runtime: fixture.runtime });
	const snapshot = await readPlanningSnapshot(fixture);

	expect(result.status).toBe('externally-blocked');
	expect(snapshot?.record.work.find((work) => work.id === fixture.work.id)).toEqual(expect.objectContaining({ status: 'interrupted' }));
	expect(snapshot?.record.work.find((work) => work.id === fixture.work.id)?.resultReceiptId).toBeUndefined();
	expect(snapshot?.record.findings.some((finding) => finding.scenario.includes('Rejected saved planning proposal'))).toBe(true);
	expect(snapshot?.record.claims.find((claim) => claim.id === 'required')).toStrictEqual(fixture.input.claims[0]);
});

test('does not recover terminal text from a rate-limited provider response', async () => {
	const fixture = await setupSaved({ rateLimited: true });
	await expect(invokePlanningRole({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work })).rejects.toThrow(/rate limited/);
	fixture.expire();

	const result = await runPlanning({ runtime: fixture.runtime });
	const snapshot = await readPlanningSnapshot(fixture);

	expect(result.status).toBe('externally-blocked');
	expect(snapshot?.record.work.find((work) => work.id === fixture.work.id)).toEqual(expect.objectContaining({ status: 'interrupted', attemptSequence: 2 }));
	expect(snapshot?.record.work.find((work) => work.id === fixture.work.id)?.resultReceiptId).toBeUndefined();
	expect(snapshot?.record.reviewReceipts).toStrictEqual([]);
});

const setupPersistence = async () => {
	let sabotage = true;
	const fixture = await planningClaimedWorkflowFixture({
		respond: async ({ response, invocation }) => {
			if (sabotage) {
				sabotage = false;
				const root = join(invocation.cwd, '.lightsout', 'plans', 'store-contract', '.planning');
				await rename(join(root, 'local'), join(root, 'local-preserved'));
				await writeFile(join(root, 'local'), 'Unavailable local output directory');
			}
			return response;
		},
	});
	const local = join(fixture.root, '.planning', 'local');
	return {
		...fixture,
		local,
		restore: async () => {
			await rm(local);
			await rename(join(fixture.root, '.planning', 'local-preserved'), local);
			await mkdir(local, { recursive: true });
		},
	};
};

test('retries persistence of a retained paid result before any replacement provider call', async () => {
	const fixture = await setupPersistence();
	await expect(invokePlanningRole({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work })).rejects.toMatchObject({
		externallyBlocked: true,
		preserveAttempt: true,
	});
	const retained = fixture.runtime.pendingOutput;
	expect(retained?.result.exitCode).toBe(0);
	expect(fixture.calls).toHaveLength(1);
	await fixture.restore();

	const result = await runPlanning({ runtime: fixture.runtime });
	const diagnostics = await readPlanningWorkflowDiagnostics({ root: fixture.local });

	expect(result.status).toBe('complete');
	expect(fixture.runtime.pendingOutput).toBeUndefined();
	expect(fixture.calls.filter((call) => call.prompt.includes('"role":"investigate"'))).toHaveLength(1);
	expect(diagnostics.filter((text) => text.includes('"workId":"initial:investigate"'))).toHaveLength(1);
	expect(diagnostics.join('\n')).not.toContain('Unavailable local output directory');
});
