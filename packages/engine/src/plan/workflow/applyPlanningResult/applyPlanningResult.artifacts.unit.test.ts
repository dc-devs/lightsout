import { expect, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningArtifactLayout, type PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningResult, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningDataArtifact } from '#src/plan/workflow/store/index.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';

const setup = async ({ variant }: { variant: string }) =>
	planningRoleProposalFixture({
		role: PlanningVocabulary.Role.Repair,
		arrange: ({ record, artifacts, work }) => {
			work.scope = { kind: PlanningVocabulary.Scope.Selected, claimIds: [], phaseIds: ['phase-a'], packageRoots: [] };
			if (variant === 'claim-scope') work.scope = { ...work.scope, phaseIds: [], claimIds: ['required'] };
			if (['root-scope', 'descendant-scope', 'all-root-scope', 'scope-root-escape'].includes(variant))
				work.scope = { ...work.scope, phaseIds: [], packageRoots: variant === 'all-root-scope' ? ['.'] : ['packages/engine'] };
			if (['rename', 'identity', 'stale-layout', 'new-missing-bytes', 'reserved-layout', 'data-layout', 'duplicate-layout'].includes(variant))
				work.scope = record.claims[0].scope;
			for (const [phaseId, path] of [
				['phase-a', 'phase1-source.md'],
				['phase-b', 'phase2-sibling.md'],
			]) {
				const content = `# ${phaseId} retained implementation prose\n`;
				const boundaries: PlanningScope = {
					kind: PlanningVocabulary.Scope.Selected,
					claimIds: [],
					phaseIds: [phaseId],
					packageRoots: [variant === 'descendant-scope' ? 'packages/engine/src' : 'packages/engine'],
				};
				artifacts.set(path, content);
				record.artifacts.push({
					path,
					phaseId,
					variant: PlanningVocabulary.Artifact.Phase,
					sha256: sha256({ content }),
					claimIds: ['required'],
					prerequisiteIds: [],
					exports: [],
					boundaries,
				});
			}
			if (variant === 'data-layout' || variant === 'data-edit') {
				artifacts.set('owned.md', 'Engine data');
				record.artifacts.push(planningDataArtifact({ path: 'owned.md', content: 'Engine data' }));
				work.scope = record.claims[0].scope;
			}
		},
		respond: ({ response, snapshot }) => {
			if (response.role !== PlanningVocabulary.Role.Repair || response.kind !== PlanningVocabulary.ResultKind.Terminal)
				throw new Error('Expected scoped repair');
			const a = snapshot.record.artifacts.find((artifact) => artifact.phaseId === 'phase-a');
			const b = snapshot.record.artifacts.find((artifact) => artifact.phaseId === 'phase-b');
			const work = snapshot.record.work.find((item) => item.id === response.workId);
			if (!a || !b || !work) throw new Error('Actual phase descriptors are required');
			const { sha256: hash, ...descriptor } = a;
			const edit = { path: a.path, baseHash: hash as string | null, content: '# Repaired phase A\nPreserve retry identity.\n' };
			const layouts: PlanningArtifactLayout[] = [];
			if (variant === 'outside-edit') edit.path = b.path;
			if (variant === 'stale-bytes') edit.baseHash = 'd'.repeat(64);
			if (variant === 'unestablished') {
				edit.path = 'new.md';
				edit.baseHash = null;
			}
			if (variant === 'reserved-edit') edit.path = 'planning-forbidden.md';
			if (variant === 'hidden-edit') edit.path = '.hidden.md';
			if (variant === 'non-markdown') edit.path = 'plan.ts';
			if (variant === 'data-edit') {
				edit.path = 'owned.md';
				edit.baseHash = sha256({ content: 'Engine data' });
			}
			if (
				[
					'rename',
					'identity',
					'stale-layout',
					'new-missing-bytes',
					'reserved-layout',
					'data-layout',
					'duplicate-layout',
					'scope-root-escape',
					'scope-whole',
					'scope-claim',
					'scope-phase',
				].includes(variant)
			) {
				const layout: PlanningArtifactLayout = {
					...descriptor,
					variant: PlanningVocabulary.Artifact.Phase,
					baseDescriptorDigest: sha256({ content: canonicalJson({ value: a }) }),
					boundaries: work.scope,
				};
				if (variant === 'rename') {
					layout.path = 'phase1-renamed.md';
					edit.path = layout.path;
					edit.baseHash = null;
				}
				if (variant === 'identity') layout.phaseId = 'new-identity';
				if (variant === 'stale-layout') layout.baseDescriptorDigest = 'd'.repeat(64);
				if (variant === 'new-missing-bytes') {
					layout.path = 'phase3-new.md';
					layout.phaseId = 'new-phase';
					layout.baseDescriptorDigest = null;
				}
				if (variant === 'reserved-layout') layout.path = 'planning-forbidden.md';
				if (variant === 'data-layout') {
					layout.path = 'owned.md';
					const data = snapshot.record.artifacts.find((item) => item.path === 'owned.md');
					layout.baseDescriptorDigest = sha256({ content: canonicalJson({ value: data }) });
				}
				if (variant === 'scope-root-escape') layout.boundaries = { ...work.scope, packageRoots: ['packages/other'] };
				if (variant === 'scope-whole') layout.boundaries = { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] };
				if (variant === 'scope-claim') layout.boundaries = { ...work.scope, claimIds: ['required'] };
				if (variant === 'scope-phase') layout.boundaries = { ...work.scope, phaseIds: ['phase-b'] };
				layouts.push(layout);
				if (variant === 'duplicate-layout') layouts.push(layout);
			}
			return {
				...response,
				claims: [],
				resolutions: [],
				artifactEdits: variant === 'new-missing-bytes' ? [] : variant === 'duplicate-edit' ? [edit, edit] : [edit],
				...(layouts.length ? { artifactLayouts: layouts } : {}),
			};
		},
	});

test.each(['phase-scope', 'claim-scope', 'root-scope', 'descendant-scope', 'all-root-scope', 'rename'])(
	'accepts an authorized localized edit and retains sibling bytes: %s',
	async (variant) => {
		const fixture = await setup({ variant });

		const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });

		expect(result.accepted).toBe(true);
		expect(result.snapshot.artifacts.get('phase2-sibling.md')).toBe('# phase-b retained implementation prose\n');
		const phase = result.snapshot.record.artifacts.find((artifact) => artifact.phaseId === 'phase-a');
		expect(phase?.path).toBe(variant === 'rename' ? 'phase1-renamed.md' : 'phase1-source.md');
		expect(result.snapshot.artifacts.get(phase?.path ?? '')).toBe('# Repaired phase A\nPreserve retry identity.\n');
		expect(result.snapshot.record.confirmations).toStrictEqual(fixture.before.record.confirmations);
	},
);

test.each([
	'outside-edit',
	'stale-bytes',
	'unestablished',
	'reserved-edit',
	'hidden-edit',
	'non-markdown',
	'data-edit',
	'identity',
	'stale-layout',
	'new-missing-bytes',
	'reserved-layout',
	'data-layout',
	'duplicate-layout',
	'duplicate-edit',
	'scope-root-escape',
	'scope-whole',
	'scope-claim',
	'scope-phase',
])('rejects unsafe or stale artifact changes without publishing any effect: %s', async (variant) => {
	const fixture = await setup({ variant });

	await expect(applyPlanningResult({ runtime: fixture.runtime, result: fixture.result })).rejects.toThrow(
		/scope|Stale|reserved|engine data|phase identity|authored bytes|Duplicate|established authoring layout/i,
	);

	expect((await readPlanningSnapshot(fixture))?.digest).toBe(fixture.before.digest);
});
