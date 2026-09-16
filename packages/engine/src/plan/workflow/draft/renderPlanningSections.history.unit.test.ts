import { describe, expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { parsePlan } from '#src/plan/index.ts';
import { renderPlanningSections } from '#src/plan/workflow/draft/index.ts';
import { planningDraftFixture } from '#tests/helpers/planningDraftFixture.ts';

const setup = async () => {
	const fixture = await planningDraftFixture();
	const snapshot = { ...structuredClone(fixture.snapshot), artifacts: new Map(fixture.snapshot.artifacts) };
	const root = snapshot.record.claims.find(({ id }) => id === 'retry-choice');
	if (!root) throw new Error('Expected original decision');
	return { ...fixture, snapshot, root };
};

describe('renderPlanningSections', () => {
	test('retains superseded decisions and records scoped, global and unresolved constraints with their actual provenance', async () => {
		const fixture = await setup();
		const { snapshot, root } = fixture;
		root.state = PlanningVocabulary.ClaimState.Superseded;
		snapshot.record.claims.push(
			{
				...root,
				id: 'revised-retry',
				supersedes: root.id,
				state: PlanningVocabulary.ClaimState.Settled,
				text: 'Persist the key before sending.',
				confirmationId: 'explicit-approval',
			},
			{
				...root,
				id: 'global-rule',
				state: PlanningVocabulary.ClaimState.Settled,
				kind: PlanningVocabulary.ClaimKind.Constraint,
				scope: fixture.scope,
				text: 'Never delete completed data.',
				legacySettlementId: 'imported-decision',
			},
			{
				...root,
				id: 'local-rule',
				state: PlanningVocabulary.ClaimState.Unresolved,
				kind: PlanningVocabulary.ClaimKind.Constraint,
				text: 'Bound the retry queue.',
			},
			{
				...root,
				id: 'unassigned-rule',
				state: PlanningVocabulary.ClaimState.Settled,
				kind: PlanningVocabulary.ClaimKind.Constraint,
				scope: { ...root.scope, phaseIds: [], packageRoots: [] },
				text: 'Preserve tracing.',
			},
			{
				...root,
				id: 'package-rule',
				state: PlanningVocabulary.ClaimState.Settled,
				kind: PlanningVocabulary.ClaimKind.Constraint,
				scope: { ...root.scope, packageRoots: ['src'] },
				text: 'Keep package ownership.',
			},
		);

		const rendered = renderPlanningSections({ snapshot, artifacts: snapshot.artifacts });

		const overview = rendered.get('overview.md');
		expect(overview).toContain('Reuse the original idempotency key.');
		expect(overview).toContain('(superseded by #2)');
		expect(overview).toContain('Persist the key before sending.');
		expect(overview).toContain('confirmation explicit-approval');
		expect(overview).toContain('historical settlement imported-decision');
		expect(overview).toContain('Never delete completed data.');
		expect(overview).toContain('[Applies to phases phase1-original.md, roots as assigned] Bound the retry queue.');
		expect(overview).toContain('[Applies to phases as assigned, roots as assigned] Preserve tracing.');
		expect(overview).toContain('[Applies to phases phase1-original.md, roots src] Keep package ownership.');
		expect(overview).toContain('(assumption)');
		expect(rendered.get('phase1-original.md')).toContain('Claim revised-retry; confirmation explicit-approval');
		expect(rendered.get('phase3-report.md')).toContain('Claim global-rule; historical settlement imported-decision');
	});

	test.each(['cycle', 'missing-predecessor', 'missing-phase'])('refuses broken decision history: %s', async (defect) => {
		const { snapshot, root } = await setup();
		if (defect === 'cycle') root.supersedes = root.id;
		if (defect === 'missing-predecessor') root.supersedes = 'absent';
		if (defect === 'missing-phase') root.scope.phaseIds = ['absent'];
		const before = new Map(snapshot.artifacts);

		const render = () => renderPlanningSections({ snapshot, artifacts: snapshot.artifacts });

		expect(render).toThrow(/Cyclic decision history|Missing decision predecessor|Missing decision phase/);
		expect(snapshot.artifacts).toEqual(before);
	});

	test('renders single-plan obligations without leaking superseded acceptance rows', async () => {
		const { snapshot } = await setup();
		const phase = snapshot.record.artifacts.find(({ phaseId }) => phaseId === 'A');
		const testClaim = snapshot.record.claims.find(({ id }) => id === 'test-retry');
		if (!phase || !testClaim) throw new Error('Expected phase and acceptance');
		phase.variant = PlanningVocabulary.Artifact.Single;
		phase.phaseId = undefined;
		phase.path = 'plan.md';
		snapshot.artifacts.set('plan.md', '# Single plan\n\n## Context\n\nKeep the exact retry behavior.\n');
		snapshot.record.artifacts = snapshot.record.artifacts.filter(
			({ variant }) => variant === PlanningVocabulary.Artifact.Data || variant === PlanningVocabulary.Artifact.Single,
		);
		for (const claim of snapshot.record.claims) claim.scope = { ...claim.scope, phaseIds: [] };
		snapshot.record.claims.push({ ...testClaim, id: 'retired-test', state: PlanningVocabulary.ClaimState.Superseded, text: 'Obsolete retry assertion.' });

		const rendered = renderPlanningSections({ snapshot, artifacts: snapshot.artifacts });

		const parsed = parsePlan({ content: rendered.get('plan.md') ?? '', base: 'plan.md' });
		expect(parsed.ledger).toEqual([expect.objectContaining({ testName: 'retains uploads | after retry\nfailure' })]);
		expect(rendered.get('plan.md')).toContain('Keep the exact retry behavior.');
		expect(rendered.get('plan.md')).not.toContain('Obsolete retry assertion.');
	});

	test.each(['missing-overview', 'unclosed-fence', 'empty-section'])('handles %s without discarding authored text', async (mode) => {
		const { snapshot } = await setup();
		if (mode === 'missing-overview') snapshot.artifacts.delete('overview.md');
		if (mode === 'unclosed-fence') snapshot.artifacts.set('overview.md', '# Overview\n\n```md\nKeep this incomplete example.');
		if (mode === 'empty-section') snapshot.artifacts.set('overview.md', '# Overview\n\n## Decision Log\n\n## Context\n\nKeep this prose.\n');
		const before = new Map(snapshot.artifacts);

		const render = () => renderPlanningSections({ snapshot, artifacts: snapshot.artifacts });

		if (mode === 'empty-section') {
			const rendered = render();
			expect(rendered.get('overview.md')).toContain('Keep this prose.');
			expect(rendered.get('overview.md')).toContain('Reuse the original idempotency key.');
		} else expect(render).toThrow(/Missing planning artifact|requires repair/);
		expect(snapshot.artifacts).toEqual(before);
	});
});

test('renderPlanningSections carries the actual phase file budget into its canonical declaration', async () => {
	const fixture = await planningDraftFixture();
	const artifacts = new Map(fixture.snapshot.artifacts);
	artifacts.set('phase1-original.md', `${artifacts.get('phase1-original.md')}\n## File Budget\n\n47\n`);

	const rendered = renderPlanningSections({ snapshot: fixture.snapshot, artifacts });

	expect(rendered.get('overview.md')).toContain('- **File budget:** 47');
	expect(rendered.get('phase1-original.md')).toContain('## File Budget\n\n47');
});
