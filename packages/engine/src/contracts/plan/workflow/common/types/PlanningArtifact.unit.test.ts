import { describe, expect, test } from '@jest/globals';
import { PlanningArtifact, PlanningVocabulary } from '#src/contracts/index.ts';

const setup = () => ({
	path: 'phase3-uploads.md',
	variant: PlanningVocabulary.Artifact.Phase,
	phaseId: 'uploads',
	sha256: 'a'.repeat(64),
	claimIds: ['preserve-uploads'],
	prerequisiteIds: ['identity'],
	exports: ['retryUpload'],
	boundaries: { kind: PlanningVocabulary.Scope.Selected, claimIds: [], phaseIds: ['uploads'], packageRoots: ['src/uploads'] },
});

describe('PlanningArtifact', () => {
	test('preserves absent authoring metadata in historical descriptors without inserting defaults', () => {
		const descriptor = setup();

		const parsed = PlanningArtifact.parse(descriptor);

		expect(parsed).toEqual(descriptor);
		expect(Object.hasOwn(parsed, 'scopeText')).toBe(false);
		expect(Object.hasOwn(parsed, 'declaredScripts')).toBe(false);
	});

	test('retains exact canonical scope and script metadata with stable execution identity', () => {
		const descriptor = { ...setup(), scopeText: 'Uploads | preserve retry\nordering', declaredScripts: ['test:uploads', 'verify:retry'] };

		const parsed = PlanningArtifact.parse(descriptor);

		expect(parsed).toEqual(descriptor);
		expect(parsed.phaseId).toBe('uploads');
		expect(parsed.prerequisiteIds).toEqual(['identity']);
	});

	test.each([{ scopeText: '' }, { declaredScripts: [''] }, { declaredScripts: 'test:uploads' }, { undocumented: true }])(
		'rejects malformed or unrecognized authoring metadata %j',
		(metadata) => {
			const descriptor = { ...setup(), ...metadata };

			const parsed = PlanningArtifact.safeParse(descriptor);

			expect(parsed.success).toBe(false);
		},
	);
});
