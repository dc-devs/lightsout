import { rm } from 'node:fs/promises';
import { afterEach, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';
import { buildPlanningPacket } from '#src/plan/workflow/context/buildPlanningPacket.ts';
import { planningEvidenceFixture } from '#tests/helpers/planningEvidenceFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const scope = (root: string): PlanningScope => ({ kind: PlanningVocabulary.Scope.Selected, claimIds: [], phaseIds: [], packageRoots: [root] });
const setup = async ({ requested, owned }: { requested: string; owned: string }) => {
	const context = await planningEvidenceFixture();
	directories.push(context.cwd);
	const record = structuredClone(context.snapshot.record);
	record.claims.push({
		...record.claims[0],
		id: 'local',
		confirmationId: undefined,
		owner: PlanningVocabulary.Owner.Planner,
		scope: scope(owned),
		text: 'Preserve the local adapter contract',
	});
	return { ...context, snapshot: { ...context.snapshot, record }, work: { ...context.work, scope: scope(requested) } };
};
test.each([
	{ requested: 'packages/api', owned: 'packages/api', included: true },
	{ requested: 'packages/api', owned: 'packages/api/src', included: true },
	{ requested: 'packages/api/src', owned: 'packages/api', included: true },
	{ requested: '.', owned: 'packages/api', included: true },
	{ requested: 'packages/api', owned: '.', included: true },
	{ requested: 'packages/api-other', owned: 'packages/api', included: false },
	{ requested: 'packages/web', owned: 'packages/api', included: false },
])('selects $owned for $requested with complete path-segment boundaries', async ({ requested, owned, included }) => {
	const { snapshot, work, standards } = await setup({ requested, owned });

	const result = buildPlanningPacket({ snapshot, work, standards, evidence: [] });

	expect(JSON.parse(result.prompt).claims.some((claim: { id: string }) => claim.id === 'local')).toBe(included);
});
const setupPhaseScope = async () => {
	const context = await setup({ requested: 'packages/api', owned: 'packages/other' });
	const local = context.snapshot.record.claims.find((claim) => claim.id === 'local');
	if (local === undefined) throw new Error('Missing local fixture');
	local.scope.phaseIds = ['adapter'];
	const text = 'The adapter phase';
	const descriptor = {
		...context.descriptor,
		path: 'adapter.md',
		variant: PlanningVocabulary.Artifact.Phase,
		phaseId: 'adapter',
		sha256: sha256({ content: text }),
		boundaries: local.scope,
	};
	context.snapshot.record.artifacts.push(descriptor);
	const artifacts = new Map(context.snapshot.artifacts);
	artifacts.set('adapter.md', text);
	return { ...context, snapshot: { ...context.snapshot, artifacts }, work: { ...context.work, scope: { ...scope('packages/api'), phaseIds: ['adapter'] } } };
};
test('keeps a shared phase obligation when its package scope differs from the selected package', async () => {
	const { snapshot, work, standards } = await setupPhaseScope();

	const result = buildPlanningPacket({ snapshot, work, standards, evidence: [] });

	expect(JSON.parse(result.prompt).claims.map((claim: { id: string }) => claim.id)).toContain('local');
	expect(JSON.parse(result.prompt).artifacts).toEqual(
		expect.arrayContaining([expect.objectContaining({ descriptor: expect.objectContaining({ phaseId: 'adapter' }) })]),
	);
});
const setupAncestry = async ({ cyclic }: { cyclic: boolean }) => {
	const context = await setup({ requested: 'packages/api', owned: 'packages/api' });
	const record = context.snapshot.record;
	const local = record.claims.find((claim) => claim.id === 'local');
	if (local === undefined) throw new Error('Missing local fixture');
	const prior = {
		...local,
		id: 'prior',
		state: PlanningVocabulary.ClaimState.Superseded,
		scope: scope('packages/previous'),
		text: 'Earlier adapter decision',
		dependencies: cyclic ? ['local'] : [],
	};
	record.claims.push(prior);
	local.supersedes = 'prior';
	return context;
};
test.each([false, true])('includes superseded technical provenance exactly once with cyclic=$0 semantic links', async (cyclic) => {
	const { snapshot, work, standards } = await setupAncestry({ cyclic });

	const result = buildPlanningPacket({ snapshot, work, standards, evidence: [] });

	const ids = JSON.parse(result.prompt).claims.map((claim: { id: string }) => claim.id);
	expect(ids.filter((id: string) => id === 'prior')).toStrictEqual(['prior']);
	expect(ids.filter((id: string) => id === 'local')).toStrictEqual(['local']);
});
const setupSharedPrerequisites = async () => {
	const context = await setup({ requested: 'packages/api', owned: 'packages/api' });
	const artifacts = new Map(context.snapshot.artifacts);
	for (const id of ['shared', 'first', 'second']) {
		const text = `Contract for ${id}`;
		artifacts.set(`${id}.md`, text);
		context.snapshot.record.artifacts.push({
			...context.descriptor,
			path: `${id}.md`,
			variant: PlanningVocabulary.Artifact.Phase,
			phaseId: id,
			sha256: sha256({ content: text }),
			claimIds: [],
			boundaries: scope(id === 'shared' ? 'packages/shared' : 'packages/api'),
			prerequisiteIds: id === 'shared' ? [] : ['shared'],
		});
	}
	return { ...context, snapshot: { ...context.snapshot, artifacts } };
};
test('includes a shared execution prerequisite once when two selected phases depend on it', async () => {
	const { snapshot, work, standards } = await setupSharedPrerequisites();

	const result = buildPlanningPacket({ snapshot, work, standards, evidence: [] });

	expect(
		JSON.parse(result.prompt)
			.artifacts.filter((item: { descriptor: { phaseId?: string } }) => item.descriptor.phaseId !== undefined)
			.map((item: { descriptor: { phaseId: string } }) => item.descriptor.phaseId),
	).toStrictEqual(['shared', 'first', 'second']);
});
