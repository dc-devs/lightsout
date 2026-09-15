import { expect, test } from '@jest/globals';
import { PlanningArtifactLayout } from '#src/contracts/plan/workflow/PlanningArtifactLayout.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

const setup = () => ({
	path: 'phase1-upload.md',
	variant: PlanningVocabulary.Artifact.Phase,
	phaseId: 'upload',
	baseDescriptorDigest: null,
	claimIds: ['retention'],
	prerequisiteIds: [],
	exports: ['retryUpload'],
	boundaries: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
});

test('preserves a proposed stable phase identity without inventing resulting byte hashes', () => {
	const input = setup();

	const result = PlanningArtifactLayout.parse(input);

	expect(result).toStrictEqual(input);
});

test.each(['missing-phase', 'non-phase', 'data', 'hash', 'path'])('refuses invalid layout identity or authority: %s', (mutation) => {
	const base = setup();
	const input = {
		...base,
		...(mutation === 'missing-phase' ? { phaseId: undefined } : {}),
		...(mutation === 'non-phase' ? { variant: PlanningVocabulary.Artifact.Overview } : {}),
		...(mutation === 'data' ? { variant: PlanningVocabulary.Artifact.Data } : {}),
		...(mutation === 'hash' ? { sha256: 'a'.repeat(64) } : {}),
		...(mutation === 'path' ? { path: '../escaped.md' } : {}),
	};

	const result = PlanningArtifactLayout.safeParse(input);

	expect(result.success).toBe(false);
});
