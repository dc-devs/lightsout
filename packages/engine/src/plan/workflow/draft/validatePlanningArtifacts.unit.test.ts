import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningResult } from '#src/plan/index.ts';
import { renderPlanningSections, validatePlanningArtifacts } from '#src/plan/workflow/draft/index.ts';
import { planningDraftFixture } from '#tests/helpers/planningDraftFixture.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';

const placeholder = '# Pending implementation detail\n\nArchitecture boundaries are established; detailed authoring is still required.\n';
const setupViews = async ({ mode }: { mode: 'missing' | 'placeholder' | 'missing-one' }) => {
	const fixture = await planningDraftFixture();
	const artifacts = new Map(fixture.snapshot.artifacts);
	for (const descriptor of fixture.snapshot.record.artifacts) {
		if (descriptor.variant === PlanningVocabulary.Artifact.Data) continue;
		if (mode === 'missing') artifacts.delete(descriptor.path);
		else artifacts.set(descriptor.path, placeholder);
	}
	if (mode === 'missing-one') artifacts.delete('phase1-original.md');
	return { ...fixture, artifacts };
};

describe('validatePlanningArtifacts', () => {
	test.each([{ mode: 'missing' as const }, { mode: 'missing-one' as const }])(
		'reports missing required bytes even when no authored file remains: $mode',
		async ({ mode }) => {
			const fixture = await setupViews({ mode });

			const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.snapshot, artifacts: fixture.artifacts });

			expect(findings).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ phase: 'phase1-original.md', severity: FindingSeverity.Blocking, issue: expect.stringMatching(/missing/i) }),
				]),
			);
		},
	);

	test('permits only present pre-draft architecture placeholders without forcing premature detail authoring', async () => {
		const fixture = await setupViews({ mode: 'placeholder' });

		const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.snapshot, artifacts: fixture.artifacts });

		expect(findings).toEqual([]);
		expect(fixture.calls).toHaveLength(0);
	});

	test('rejects placeholders left by an actually completed draft rather than calling them a pre-draft layout', async () => {
		const fixture = await planningRoleProposalFixture({
			role: PlanningVocabulary.Role.Draft,
			respond: ({ response }) => {
				if (response.role !== PlanningVocabulary.Role.Draft || response.kind !== PlanningVocabulary.ResultKind.Terminal)
					throw new Error('Expected a draft result');
				return { ...response, artifactEdits: response.artifactEdits.map((edit) => ({ ...edit, content: placeholder })) };
			},
		});
		const accepted = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });
		if (!accepted.accepted) throw new Error('Expected an actual completed draft to validate');

		const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: accepted.snapshot, artifacts: accepted.snapshot.artifacts });

		expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: FindingSeverity.Blocking })]));
	});

	test('reports a removed exact test mapping and cleans only its own isolated lint directory', async () => {
		const fixture = await planningDraftFixture();
		const artifacts = renderPlanningSections({ snapshot: fixture.snapshot, artifacts: fixture.snapshot.artifacts });
		artifacts.set(
			'phase1-original.md',
			(artifacts.get('phase1-original.md') ?? '').replace('retains uploads &#124; after retry&#10;failure', 'a different assertion'),
		);

		const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.snapshot, artifacts });

		expect(findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ issue: expect.stringContaining('Exact canonical acceptance behavior'), severity: FindingSeverity.Blocking }),
			]),
		);
		const local = join(fixture.cwd, '.lightsout', 'plans', fixture.name, '.planning', 'local');
		expect((await readdir(local)).filter((name) => name.startsWith('lint-'))).toEqual([]);
		expect(artifacts.get('phase1-original.md')).toContain('a different assertion');
	});
});

test('validatePlanningArtifacts does not force detailed drafting after a semantic-only pre-draft repair', async () => {
	const fixture = await planningRoleProposalFixture({
		role: PlanningVocabulary.Role.Repair,
		respond: ({ response }) => {
			if (response.role !== PlanningVocabulary.Role.Repair || response.kind !== PlanningVocabulary.ResultKind.Terminal)
				throw new Error('Expected a repair result');
			return { ...response, claims: [], artifactEdits: [], resolutions: [] };
		},
	});
	const accepted = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });
	if (!accepted.accepted) throw new Error('Expected an actual semantic-only repair');

	const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: accepted.snapshot, artifacts: accepted.snapshot.artifacts });

	expect(findings).toEqual([]);
	expect(accepted.snapshot.record.work.find(({ id }) => id === fixture.work.id)?.status).toBe(PlanningVocabulary.WorkState.Complete);
});
