import { describe, expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { parsePhaseDeclarations, parsePlan } from '#src/plan/index.ts';
import { renderPlanningSections } from '#src/plan/workflow/draft/index.ts';
import { planningDraftFixture } from '#tests/helpers/planningDraftFixture.ts';

const setup = async ({ defect }: { defect: string }) => {
	const fixture = await planningDraftFixture();
	const snapshot = structuredClone(fixture.snapshot);
	const artifacts = new Map(snapshot.artifacts);
	const phase = snapshot.record.artifacts.find(({ phaseId }) => phaseId === 'A');
	if (!phase) throw new Error('Fixture phase is missing');
	if (defect === 'missing-identity') phase.phaseId = undefined;
	if (defect === 'duplicate-identity') snapshot.record.artifacts.push({ ...phase, path: 'another.md' });
	if (defect === 'missing-dependency') phase.prerequisiteIds = ['absent'];
	if (defect === 'cycle') phase.prerequisiteIds = ['A'];
	if (defect === 'missing-bytes') artifacts.delete(phase.path);
	if (defect === 'authored-section')
		artifacts.set(phase.path, `${artifacts.get(phase.path)}\n## Acceptance Tests\n\nPreserve this unmapped authored obligation.\n`);
	return { ...fixture, snapshot: { ...snapshot, artifacts } };
};

describe('renderPlanningSections', () => {
	test.each(['missing-identity', 'duplicate-identity', 'missing-dependency', 'cycle', 'missing-bytes', 'authored-section'])(
		'rejects %s without changing the original artifact map',
		async (defect) => {
			const fixture = await setup({ defect });
			const before = new Map(fixture.snapshot.artifacts);

			const render = () => renderPlanningSections({ snapshot: fixture.snapshot, artifacts: fixture.snapshot.artifacts });

			expect(render).toThrow(/identit|prerequisite|Missing phase bytes|requires repair/i);
			expect(fixture.snapshot.artifacts).toEqual(before);
		},
	);

	test('renders justified prose verification and retains literal pipe and entity content', async () => {
		const fixture = await planningDraftFixture();
		const snapshot = {
			...fixture.snapshot,
			record: {
				...fixture.snapshot.record,
				claims: fixture.snapshot.record.claims.map((claim) =>
					claim.kind === PlanningVocabulary.ClaimKind.Acceptance
						? {
								...claim,
								acceptance: {
									kind: PlanningVocabulary.Acceptance.Prose,
									path: 'README.md',
									reason: 'Reader guidance | includes &amp; examples',
									verification: 'Inspect both retry paths\nand ordering.',
								},
							}
						: claim,
				),
			},
		};

		const rendered = renderPlanningSections({ snapshot, artifacts: snapshot.artifacts });

		expect(rendered.get('phase1-original.md')).toContain(
			'- `README.md` — Reader guidance &#124; includes &amp;amp; examples Verification: Inspect both retry paths&#10;and ordering.',
		);
		expect(parsePlan({ content: rendered.get('phase1-original.md') ?? '', base: 'phase1-original.md' }).ledger).toEqual([]);
		expect(rendered.get('phase3-report.md')).toContain('None.');
	});

	test('preserves exact existing phase metadata when historical descriptors do not yet carry those optional fields', async () => {
		const fixture = await planningDraftFixture();
		const record = structuredClone(fixture.snapshot.record);
		const phase = record.artifacts.find(({ phaseId }) => phaseId === 'A');
		if (!phase) throw new Error('Expected original phase');
		phase.scopeText = 'Exact | multiline\nphase purpose';
		phase.declaredScripts = ['check:retry'];
		const first = renderPlanningSections({ snapshot: { ...fixture.snapshot, record }, artifacts: fixture.snapshot.artifacts });
		phase.scopeText = undefined;
		phase.declaredScripts = undefined;
		const snapshot = { ...fixture.snapshot, record, artifacts: first };

		const rendered = renderPlanningSections({ snapshot, artifacts: first });

		expect(rendered.get('overview.md')).toBe(first.get('overview.md'));
		const declarations = parsePhaseDeclarations({ plan: parsePlan({ content: rendered.get('overview.md') ?? '', base: 'overview.md' }) });
		expect(declarations[0]).toEqual(expect.objectContaining({ scope: 'Exact | multiline\nphase purpose', scripts: ['check:retry'] }));
	});
});
