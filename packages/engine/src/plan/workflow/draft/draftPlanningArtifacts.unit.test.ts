import { describe, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningResult, readPlanningSnapshot } from '#src/plan/index.ts';
import { draftPlanningArtifacts, renderPlanningContract, renderPlanningSections, validatePlanningArtifacts } from '#src/plan/workflow/draft/index.ts';
import { planningDraftFixture } from '#tests/helpers/planningDraftFixture.ts';

const setupSections = async () => {
	const fixture = await planningDraftFixture();
	const rendered = renderPlanningSections({ snapshot: fixture.snapshot, artifacts: fixture.snapshot.artifacts });
	const previous = {
		...fixture.snapshot,
		artifacts: rendered,
		record: {
			...fixture.snapshot.record,
			artifacts: fixture.snapshot.record.artifacts.map((artifact) => ({ ...artifact, sha256: sha256({ content: rendered.get(artifact.path) ?? '' }) })),
		},
	};
	const changed = {
		...previous,
		record: {
			...previous.record,
			claims: previous.record.claims.map((claim) =>
				claim.id === 'retry-choice' ? { ...claim, text: 'Retain the key across timeout and retry.', contentRevision: 2 } : claim,
			),
		},
	};
	const malformed = new Map(rendered);
	malformed.set(
		'phase1-original.md',
		`${rendered.get('phase1-original.md')}\n## Acceptance Tests\n\nAn authored obligation must survive a duplicate heading.\n`,
	);
	return { ...fixture, previous, changed, malformed };
};

const setupMissingCoverage = async () => {
	const fixture = await planningDraftFixture({ exactStandards: true });
	const broken = {
		...fixture.snapshot,
		record: {
			...fixture.snapshot.record,
			claims: fixture.snapshot.record.claims.map((claim) => (claim.id === 'test-retry' ? { ...claim, dependencies: [] } : claim)),
		},
	};
	const artifacts = renderPlanningSections({ snapshot: broken, artifacts: broken.artifacts });
	const missing = {
		...broken,
		artifacts,
		record: {
			...broken.record,
			artifacts: broken.record.artifacts.map((artifact) => ({ ...artifact, sha256: sha256({ content: artifacts.get(artifact.path) ?? '' }) })),
		},
	};
	return { ...fixture, missing };
};

const setupRestored = async () => {
	const fixture = await planningDraftFixture({ exactStandards: true });
	const restored = await readPlanningSnapshot({ cwd: fixture.cwd, name: fixture.name, generation: fixture.snapshot.digest });
	if (!restored) throw new Error('Published generation was not restored');
	const missing = new Map(restored.artifacts);
	missing.delete('planning-standards.json');
	const tampered = new Map(restored.artifacts);
	tampered.set('planning-standards.json', `${restored.artifacts.get('planning-standards.json')} `);
	return { ...fixture, restored, missing, tampered };
};

describe('draftPlanningArtifacts', () => {
	test('renders authoritative sections without losing semantic content', async () => {
		const fixture = await setupSections();

		const rendered = renderPlanningSections({ snapshot: fixture.changed, artifacts: fixture.changed.artifacts, previous: fixture.previous });
		const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.changed, artifacts: fixture.malformed });

		expect(rendered.get('phase1-original.md')).toContain('This example heading is implementation prose, not an engine section.');
		expect(rendered.get('phase1-original.md')).toContain('Implement the shared retry contract without deleting completed data.');
		expect(rendered.get('phase3-report.md')).toBe(fixture.previous.artifacts.get('phase3-report.md'));
		expect(rendered.get('overview.md')).toContain('Retain the key across timeout and retry.');
		expect(rendered.get('overview.md')).toMatch(/phase1-original\.md.*1.*1/);
		expect(rendered.get('overview.md')).toContain('retryUpload');
		expect(findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ severity: 'blocking', phase: 'phase1-original.md', issue: expect.stringMatching(/duplicate|regenerat|repair/i) }),
			]),
		);
		expect(fixture.malformed.get('phase1-original.md')).toContain('An authored obligation must survive a duplicate heading.');
		expect(() => renderPlanningSections({ snapshot: fixture.changed, artifacts: fixture.malformed })).toThrow(/repair/i);
	});

	test('repairs one phase without redrafting unchanged siblings', async () => {
		const fixture = await planningDraftFixture({ repair: true });

		const proposal = await draftPlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work });
		const accepted = await applyPlanningResult({ runtime: fixture.runtime, result: proposal });

		expect(accepted.accepted).toBe(true);
		expect(fixture.calls).toHaveLength(1);
		expect(fixture.calls[0]?.prompt).toContain('retryUpload({ uploadId }: { uploadId: string }): Promise<Upload>');
		expect(fixture.calls[0]?.systemPrompt).toMatch(/single plan|phase plan|phase file/i);
		expect(fixture.calls[0]?.environment).toEqual(expect.objectContaining({ noMcpServers: true, noSkillCatalog: true, settingsPreserved: true }));
		expect(accepted.snapshot.artifacts.get('phase3-report.md')).toBe(fixture.proseC);
		expect(accepted.snapshot.record.artifacts.find((artifact) => artifact.phaseId === 'C')).toEqual(
			fixture.snapshot.record.artifacts.find((artifact) => artifact.phaseId === 'C'),
		);
		expect(accepted.snapshot.artifacts.has('phase1-original.md')).toBe(false);
		expect(accepted.snapshot.record.artifacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: 'phase1-upload.md', phaseId: 'A' }),
				expect.objectContaining({ path: 'phase2-retry.md', phaseId: `phase:${proposal.attemptId}:${sha256({ content: 'B' })}`, prerequisiteIds: ['A'] }),
			]),
		);
		expect(fixture.deltas).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					artifactPaths: expect.arrayContaining(['phase1-original.md', 'phase1-upload.md', 'phase2-retry.md']),
					boundaryPaths: expect.arrayContaining(['phase1-original.md', 'phase1-upload.md', 'phase2-retry.md']),
				}),
			]),
		);
	});

	test('retains contracts standards and named test obligations', async () => {
		const fixture = await setupMissingCoverage();

		const contract = renderPlanningContract({ snapshot: fixture.snapshot, phaseId: 'A' });
		const findings = await validatePlanningArtifacts({ runtime: fixture.runtime, snapshot: fixture.missing, artifacts: fixture.missing.artifacts });

		expect(contract.claims).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: 'required', text: 'Preserve completed uploads', origin: fixture.origin })]),
		);
		expect(contract.interfaces).toContain('retryUpload({ uploadId }: { uploadId: string }): Promise<Upload>');
		expect(contract.invariants).toEqual(
			expect.arrayContaining([
				'Read completion before scheduling another write.',
				'A failed retry must not delete completed uploads.',
				'Only the upload service owns retry identity.',
			]),
		);
		expect(contract.acceptance).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					acceptance: expect.objectContaining({ testFile: 'src/retryUpload.unit.test.ts', testName: 'retains uploads | after retry\nfailure', gate: 'test' }),
				}),
			]),
		);
		expect(contract.standards.map(({ text }) => text)).toEqual(fixture.channels.map(({ text }) => text));
		expect(contract.privateFreedom).toMatch(/private/i);
		expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'blocking', issue: expect.stringContaining('required') })]));
	});

	test('renders and restores the exact authoritative standards content', async () => {
		const fixture = await setupRestored();

		const contract = renderPlanningContract({ snapshot: fixture.restored, phaseId: 'A' });

		expect(contract.generation).toBe(fixture.snapshot.digest);
		expect(contract.standards).toEqual(
			fixture.channels.map(({ text, ...descriptor }) => ({ text, descriptor: { ...descriptor, artifact: 'planning-standards.json' } })),
		);
		expect(contract.standards.map(({ descriptor }) => descriptor.channel)).toEqual(['code', 'test', 'docs']);
		expect(() => renderPlanningContract({ snapshot: { ...fixture.restored, artifacts: fixture.missing }, phaseId: 'A' })).toThrow(/standards/i);
		expect(() => renderPlanningContract({ snapshot: { ...fixture.restored, artifacts: fixture.tampered }, phaseId: 'A' })).toThrow(/standards/i);
		expect(fixture.calls).toHaveLength(0);
		expect(contract.claims.some((claim) => claim.kind === PlanningVocabulary.ClaimKind.Contract)).toBe(true);
	});
});
