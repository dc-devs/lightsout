import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { invokePlanningRole, readPlanningSnapshot } from '#src/plan/index.ts';
import { applyPlanningResult } from '#src/plan/workflow/applyPlanningResult/applyPlanningResult.ts';
import { planningArchitectProposalFixture } from '#tests/helpers/planningArchitectProposalFixture.ts';
import { planningClaimedWorkflowFixture } from '#tests/helpers/planningClaimedWorkflowFixture.ts';

const setupIdentity = async ({ key }: { key: 'workId' | 'attemptId' | 'inputDigest' | 'invocationId' | 'packetDigest' }) => {
	const fixture = await planningArchitectProposalFixture();
	const before = await readPlanningSnapshot(fixture);
	return { ...fixture, before, result: { ...fixture.result, [key]: sha256({ content: 'not the current invocation' }) } };
};

test.each(['workId', 'attemptId', 'inputDigest', 'invocationId', 'packetDigest'] as const)(
	'rejects a terminal proposal with stale %s without publishing effects',
	async (key) => {
		const fixture = await setupIdentity({ key });

		const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });

		expect(result.accepted).toBe(false);
		expect(result.snapshot.digest).toBe(fixture.before?.digest);
		expect(result.snapshot.record.claims.some((claim) => claim.kind === 'architecture')).toBe(false);
	},
);

const setupInvalid = async ({ mutation }: { mutation: string }) => {
	const fixture = await planningArchitectProposalFixture();
	const result = structuredClone(fixture.result);
	const claim = result.claims[0];
	const layout = result.artifactLayouts?.[0];
	if (!claim || !layout) throw new Error('Fixture architecture requires a claim and layout');
	if (mutation === 'origin') claim.origin = { ...claim.origin, locator: 'invented source' };
	if (mutation === 'claim-alias') result.claims.push({ ...claim });
	if (mutation === 'user-rewrite') claim.id = 'required';
	if (mutation === 'reserved') layout.path = 'planning-private.md';
	if (mutation === 'layout-base') layout.baseDescriptorDigest = 'f'.repeat(64);
	if (mutation === 'layout-alias') result.artifactLayouts?.push({ ...layout });
	if (mutation === 'dependency')
		result.dependencies.push({ id: 'invented', kind: PlanningVocabulary.Dependency.Content, path: 'unread.ts', sha256: 'a'.repeat(64) });
	if (mutation === 'judge')
		result.work.push({
			...fixture.work,
			id: 'unconditional-judge',
			role: PlanningVocabulary.Role.Adjudicate,
			status: PlanningVocabulary.WorkState.Pending,
			attemptSequence: 0,
			currentAttemptId: undefined,
			resultReceiptId: undefined,
			prerequisiteIds: [],
		});
	return { ...fixture, result, before: await readPlanningSnapshot(fixture) };
};

test.each(['origin', 'claim-alias', 'user-rewrite', 'reserved', 'layout-base', 'layout-alias', 'dependency', 'judge'])(
	'rejects unearned proposal authority (%s) atomically',
	async (mutation) => {
		const fixture = await setupInvalid({ mutation });

		await expect(applyPlanningResult({ runtime: fixture.runtime, result: fixture.result })).rejects.toThrow();
		const after = await readPlanningSnapshot(fixture);

		expect(after?.digest).toBe(fixture.before?.digest);
		expect(after?.record.claims.find((claim) => claim.id === 'required')).toStrictEqual(fixture.input.claims[0]);
		expect(after?.record.work.find((work) => work.id === fixture.work.id)?.status).toBe('running');
	},
);

const setupDrift = async () => {
	const fixture = await planningClaimedWorkflowFixture();
	const path = join(fixture.cwd, 'handler.ts');
	await writeFile(path, 'export const retry = "preserve";');
	const result = await invokePlanningRole({
		runtime: fixture.runtime,
		snapshot: fixture.snapshot,
		work: fixture.work,
		evidenceRequests: [
			{ requestId: 'handler', operation: PlanningVocabulary.Operation.ReadFile, path: 'handler.ts', reason: 'Read the actual retry behavior' },
		],
	});
	await writeFile(path, 'export const retry = "delete";');
	return { ...fixture, result, before: await readPlanningSnapshot(fixture) };
};

test('rejects actual observed source drift before applying a saved response', async () => {
	const fixture = await setupDrift();

	const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });

	expect(result.accepted).toBe(false);
	expect(result.reason).toMatch(/inputs changed/);
	expect(result.snapshot.digest).toBe(fixture.before?.digest);
	expect(result.snapshot.record.work.find((work) => work.id === fixture.work.id)?.resultReceiptId).toBeUndefined();
});
