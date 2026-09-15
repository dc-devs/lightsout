import { expect, test } from '@jest/globals';
import { FindingSeverity, PlanningVocabulary, StructuralCheck } from '#src/contracts/index.ts';
import { readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

const setup = async ({ phased = false, duplicate = false } = {}) => {
	const fixture = await planningWorkflowFixture({
		respond: async ({ response }) => {
			if (phased && response.kind === 'terminal' && response.role === 'architect') {
				if (!response.artifactLayouts) throw new Error('Expected actual architecture layouts in the fixture response');
				response.artifactLayouts = response.artifactLayouts.map((layout) => ({
					...layout,
					variant: PlanningVocabulary.Artifact.Phase,
					phaseId: 'retry-phase',
				}));
			}
			return response;
		},
	});
	fixture.runtime.services.validate = async ({ snapshot }) =>
		snapshot.artifacts.get('plan.md')?.includes('Missing shared retry signature')
			? []
			: [
					{
						check: StructuralCheck.SectionsPresent,
						severity: FindingSeverity.Blocking,
						phase: 'plan.md',
						issue: 'Missing shared retry signature',
						location: 'plan.md',
						fix: 'Specify the shared retry signature',
					},
				];
	if (duplicate) {
		const validate = fixture.runtime.services.validate;
		fixture.runtime.services.validate = async (params) => {
			const findings = await validate(params);
			return [...findings, ...findings];
		};
	}
	await fixture.capture();
	return fixture;
};

test('repairs an engine structural finding directly and requires independent verification before completion', async () => {
	const fixture = await setup();

	const result = await runPlanning({ runtime: fixture.runtime });
	const snapshot = await readPlanningSnapshot(fixture);

	expect(result.status).toBe('complete');
	expect(snapshot?.record.findings.find((finding) => finding.scenario.includes('Missing shared retry signature'))).toEqual(
		expect.objectContaining({ state: 'verified', verificationReceiptIds: expect.arrayContaining([expect.any(String)]) }),
	);
	expect(snapshot?.record.work.some((work) => work.role === 'repair' && work.status === 'complete')).toBe(true);
	expect(snapshot?.record.work.some((work) => work.role === 'adjudicate')).toBe(false);
	expect(snapshot?.artifacts.get('plan.md')).toContain('Missing shared retry signature');
});

test('deduplicates identical structural defects into one repair and verification obligation', async () => {
	const fixture = await setup({ duplicate: true });

	const result = await runPlanning({ runtime: fixture.runtime });
	const snapshot = await readPlanningSnapshot(fixture);

	expect(result.status).toBe('complete');
	expect(snapshot?.record.findings.filter((finding) => finding.scenario === 'Missing shared retry signature')).toHaveLength(1);
	expect(snapshot?.record.work.filter((work) => work.id.startsWith('repair:structural:'))).toHaveLength(1);
	expect(snapshot?.record.work.filter((work) => work.id.startsWith('review:structural:'))).toHaveLength(1);
});

test('limits structural repair and verification to the affected stable phase', async () => {
	const fixture = await setup({ phased: true });

	const result = await runPlanning({ runtime: fixture.runtime });
	const snapshot = await readPlanningSnapshot(fixture);
	const phase = snapshot?.record.artifacts.find((artifact) => artifact.path === 'plan.md');
	if (!phase?.phaseId) throw new Error('Expected the actual architecture-assigned stable phase');
	const finding = snapshot?.record.findings.find((item) => item.scenario === 'Missing shared retry signature');

	expect(result.status).toBe('complete');
	expect(finding).toEqual(
		expect.objectContaining({ state: 'verified', scope: { kind: 'selected', phaseIds: [phase.phaseId], claimIds: [], packageRoots: [] } }),
	);
	const work = snapshot?.record.work.filter((item) => item.id.startsWith('repair:structural:') || item.id.startsWith('review:structural:'));
	expect(work).toHaveLength(2);
	expect(
		work?.every(
			(item) => item.status === 'complete' && item.scope.kind === 'selected' && item.scope.phaseIds.length === 1 && item.scope.phaseIds[0] === phase.phaseId,
		),
	).toBe(true);
});
