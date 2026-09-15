import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { capturePlanningInput, claimPlanningAttempt, invokePlanningRole, PlanningLease, runPlanning } from '#src/plan/index.ts';
import { planningClaimedWorkflowFixture } from '#tests/helpers/planningClaimedWorkflowFixture.ts';
import { readPlanningWorkflowDiagnostics } from '#tests/helpers/readPlanningWorkflowDiagnostics.ts';

const setup = async ({ evidence = false } = {}) => {
	let first = true;
	let competingClaim: boolean | undefined;
	let continuedAttempt: string | undefined;
	let probe: ((inputDigest: string) => Promise<void>) | undefined;
	const fixture = await planningClaimedWorkflowFixture({
		respond: async ({ response, invocation }) => {
			if (first) {
				first = false;
				const root = join(invocation.cwd, '.lightsout', 'plans', 'store-contract', '.planning');
				await rename(join(root, 'local'), join(root, 'local-preserved'));
				await writeFile(join(root, 'local'), 'Storage unavailable');
				if (evidence)
					return {
						kind: PlanningVocabulary.ResultKind.EvidenceRequest,
						role: response.role,
						workId: response.workId,
						attemptId: response.attemptId,
						inputDigest: response.inputDigest,
						invocationId: response.invocationId,
						packetDigest: response.packetDigest,
						requests: [
							{ requestId: 'handler', operation: PlanningVocabulary.Operation.ReadFile, path: 'handler.ts', reason: 'Inspect completed upload handling' },
						],
					};
				return response;
			}
			continuedAttempt = response.attemptId;
			await probe?.(response.inputDigest);
			return { text: 'Provider unavailable after continuation probe', exitCode: 1, rateLimited: true };
		},
	});
	await writeFile(join(fixture.cwd, 'handler.ts'), 'export const upload = "preserved";');
	const local = join(fixture.root, '.planning', 'local');
	const restore = async () => {
		await rm(local);
		await rename(join(fixture.root, '.planning', 'local-preserved'), local);
	};
	probe = async (inputDigest) => {
		const competing = await claimPlanningAttempt({
			runtime: { ...fixture.runtime, lease: new PlanningLease({ cwd: fixture.cwd, name: fixture.name, now: fixture.runtime.clock }) },
			workId: fixture.work.id,
			expectedInputDigest: inputDigest,
		});
		competingClaim = competing.claimed;
	};
	return { ...fixture, local, restore, result: () => ({ competingClaim, continuedAttempt }) };
};

test('claims a new canonical attempt before continuing retained evidence under an expired lease', async () => {
	const fixture = await setup({ evidence: true });
	await expect(invokePlanningRole({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work })).rejects.toMatchObject({
		preserveAttempt: true,
	});
	await fixture.restore();
	fixture.expire();

	const result = await runPlanning({ runtime: fixture.runtime });

	expect(result.status).toBe('externally-blocked');
	expect(fixture.result().competingClaim).toBe(false);
	expect(fixture.result().continuedAttempt).toEqual(expect.any(String));
	expect(fixture.result().continuedAttempt).not.toBe(fixture.work.currentAttemptId);
	expect(fixture.calls).toHaveLength(2);
	expect(fixture.calls[1].prompt).toContain('export const upload');
});

test('persists a retained stale response even when new user input has retired its running attempt', async () => {
	const fixture = await setup();
	await expect(invokePlanningRole({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work })).rejects.toMatchObject({
		preserveAttempt: true,
	});
	const retained = fixture.runtime.pendingOutput;
	await fixture.restore();
	const original = fixture.input.claims[0];
	if (!original) throw new Error('Missing original fixture claim');
	const text = 'Also retain upload metadata';
	const origin = { artifact: 'metadata.md', locator: 'Requirement', text, sha256: sha256({ content: text }) };
	await capturePlanningInput({
		runtime: fixture.runtime,
		input: {
			stage: fixture.runtime.stage,
			sources: [origin],
			claims: [{ ...original, id: 'metadata', text, origin, state: PlanningVocabulary.ClaimState.Unresolved, confirmationId: undefined }],
			confirmations: [],
		},
	});

	const result = await runPlanning({ runtime: fixture.runtime });
	const diagnostics = (await readPlanningWorkflowDiagnostics({ root: fixture.local }))
		.map((text) => JSON.parse(text))
		.filter((row) => typeof row.callId === 'string');

	expect(result.status).toBe('awaiting-user');
	expect(fixture.runtime.pendingOutput).toBeUndefined();
	expect(fixture.calls).toHaveLength(1);
	expect(diagnostics).toHaveLength(1);
	expect(diagnostics[0]).toEqual(expect.objectContaining({ attemptId: retained?.attemptId, text: retained?.result.text, exitCode: 0 }));
});
