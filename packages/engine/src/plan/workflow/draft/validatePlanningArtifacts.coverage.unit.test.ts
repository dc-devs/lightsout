import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, PlanningVocabulary } from '#src/contracts/index.ts';
import { renderPlanningSections, validatePlanningArtifacts } from '#src/plan/workflow/draft/index.ts';
import { planningDraftFixture } from '#tests/helpers/planningDraftFixture.ts';

const setup = async () => {
	const fixture = await planningDraftFixture();
	const snapshot = structuredClone(fixture.snapshot);
	const artifacts = renderPlanningSections({ snapshot, artifacts: snapshot.artifacts });
	return { ...fixture, snapshot, artifacts };
};

describe('validatePlanningArtifacts', () => {
	test.each([
		['criterion', 'Given a retry failure, keep the completed upload.', 'Different requirement'],
		['file', 'src/retryUpload.unit.test.ts', 'src/other.unit.test.ts'],
		['gate', '| test |', '| check |'],
	])('requires the exact acceptance %s, not just a matching test title', async (_field, original, replacement) => {
		const fixture = await setup();
		fixture.artifacts.set('phase1-original.md', (fixture.artifacts.get('phase1-original.md') ?? '').replace(original, replacement));

		const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.snapshot, artifacts: fixture.artifacts });

		expect(findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					phase: 'phase1-original.md',
					severity: FindingSeverity.Blocking,
					issue: 'test-retry: Exact canonical acceptance behavior or prose justification is missing from its implementation view',
				}),
			]),
		);
	});

	test('reports an acceptance obligation without any responsible phase', async () => {
		const fixture = await setup();
		const claim = fixture.snapshot.record.claims.find(({ id }) => id === 'test-retry');
		if (!claim) throw new Error('Missing acceptance claim');
		claim.scope = { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] };
		for (const artifact of fixture.snapshot.record.artifacts) artifact.claimIds = artifact.claimIds.filter((id) => id !== claim.id);

		const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.snapshot, artifacts: fixture.artifacts });

		expect(findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ severity: FindingSeverity.Blocking, issue: 'test-retry: Acceptance mapping has no responsible implementation artifact' }),
			]),
		);
	});

	test('reports a missing authored phase and continues checking the surviving artifacts without leaving staged lint files', async () => {
		const fixture = await setup();
		fixture.artifacts.delete('phase1-original.md');

		const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.snapshot, artifacts: fixture.artifacts });

		expect(findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ phase: 'phase1-original.md', issue: 'Missing required planning artifact bytes' }),
				expect.objectContaining({
					phase: 'phase1-original.md',
					issue: 'test-retry: Exact canonical acceptance behavior or prose justification is missing from its implementation view',
				}),
			]),
		);
		expect((await readdir(join(fixture.cwd, '.lightsout', 'plans', fixture.name, '.planning', 'local'))).filter((name) => name.startsWith('lint-'))).toEqual(
			[],
		);
	});

	test('rejects an invalid graph before attempting structural lint', async () => {
		const fixture = await setup();
		fixture.snapshot.record.claims.push(fixture.snapshot.record.claims[0]);

		const validation = validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.snapshot, artifacts: fixture.artifacts });

		await expect(validation).rejects.toThrow('Invalid planning graph');
		expect(fixture.calls).toHaveLength(0);
	});

	test('reports a newly captured original source until its obligations are classified', async () => {
		const fixture = await setup();
		fixture.snapshot.record.sources.push({ ...fixture.snapshot.record.sources[0], locator: 'Second product design' });

		const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.snapshot, artifacts: fixture.artifacts });

		expect(findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ severity: FindingSeverity.Blocking, issue: expect.stringContaining('Unclassified original source:') }),
			]),
		);
	});

	test.each([false, true])('requires the exact justified prose verification, corrupted=%s', async (corrupted) => {
		const fixture = await planningDraftFixture();
		const snapshot = structuredClone(fixture.snapshot);
		snapshot.record.claims = snapshot.record.claims.map((claim) =>
			claim.kind === PlanningVocabulary.ClaimKind.Acceptance
				? {
						...claim,
						acceptance: {
							kind: PlanningVocabulary.Acceptance.Prose,
							path: 'README.md',
							reason: 'User-facing guide | &amp; examples',
							verification: 'Inspect the failure section.\nPreserve ordering.',
						},
					}
				: claim,
		);
		const artifacts = renderPlanningSections({ snapshot, artifacts: snapshot.artifacts });
		if (corrupted)
			artifacts.set('phase1-original.md', (artifacts.get('phase1-original.md') ?? '').replace('Inspect the failure section.', 'Skip the failure section.'));

		const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot, artifacts });

		const coverage = findings.filter(({ issue }) => issue.startsWith('test-retry:'));
		if (corrupted)
			expect(coverage).toEqual([
				expect.objectContaining({ issue: 'test-retry: Exact canonical acceptance behavior or prose justification is missing from its implementation view' }),
			]);
		else expect(coverage).toEqual([]);
	});

	test.each([false, true])('requires an observed prior-art path to accompany its reuse or distinction decision, recorded=%s', async (recorded) => {
		const fixture = await setup();
		await mkdir(join(fixture.cwd, 'existing'), { recursive: true });
		await writeFile(join(fixture.cwd, 'existing', 'retryUpload.ts'), 'export const retryUpload = () => "existing behavior";');
		if (recorded)
			fixture.artifacts.set(
				'phase1-original.md',
				`${fixture.artifacts.get('phase1-original.md')}\n## Prior Art\n\nReuse the identity machinery in existing/retryUpload.ts; preserve its behavior.\n`,
			);

		const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.snapshot, artifacts: fixture.artifacts });

		const collisions = findings.filter(({ issue }) => issue.startsWith('Export retryUpload has observed prior art:'));
		if (recorded) expect(collisions).toEqual([]);
		else
			expect(collisions).toEqual([
				expect.objectContaining({
					severity: FindingSeverity.Blocking,
					phase: 'phase1-original.md',
					issue: 'Export retryUpload has observed prior art: existing/retryUpload.ts',
				}),
			]);
	});

	test('follows cyclic semantic acceptance ancestry without repeatedly traversing or losing binding obligations', async () => {
		const fixture = await setup();
		const contract = fixture.snapshot.record.claims.find(({ id }) => id === 'shared-api');
		if (!contract) throw new Error('Missing shared contract');
		contract.dependencies.push('test-retry');

		const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.snapshot, artifacts: fixture.artifacts });

		expect(findings.filter(({ issue }) => issue.includes('Binding source obligation lacks') || issue.startsWith('test-retry:'))).toEqual([]);
	});
});
