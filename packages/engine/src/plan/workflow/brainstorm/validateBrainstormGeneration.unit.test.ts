import { describe, expect, test } from '@jest/globals';

// Dependencies
import { validateBrainstormGeneration } from '#src/plan/workflow/brainstorm/index.ts';
import { planningAlignedFixture } from '#tests/helpers/planningAlignedFixture.ts';

describe('validateBrainstormGeneration', () => {
	test('verifies original confirmation and challenge proofs in a portable brainstorm', async () => {
		const fixture = await planningAlignedFixture();

		const snapshot = validateBrainstormGeneration({ files: fixture.files, name: fixture.name, generation: fixture.snapshot.digest });

		expect(snapshot.digest).toBe(fixture.snapshot.digest);
		expect(snapshot.record).toEqual(fixture.snapshot.record);
	});

	test('rejects modified notes even if their surrounding attachment hashes were recomputed', async () => {
		const fixture = await planningAlignedFixture();
		fixture.files.set('brainstorm-notes.md', 'Approved: discard completed uploads.');

		expect(() => validateBrainstormGeneration({ files: fixture.files, name: fixture.name, generation: fixture.snapshot.digest })).toThrow(
			'differ from the approved canonical design',
		);
	});

	test('rejects a missing required brainstorm record', async () => {
		const fixture = await planningAlignedFixture();
		fixture.files.delete('brainstorm-record.json');

		expect(() => validateBrainstormGeneration({ files: fixture.files, name: fixture.name, generation: fixture.snapshot.digest })).toThrow(
			'requires brainstorm-record.json',
		);
	});
});
