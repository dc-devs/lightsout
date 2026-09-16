import { expect, test } from '@jest/globals';
import { readPlanningTransport } from '#src/plan/common/planning/readPlanningTransport.ts';
import { planningPortableFixture } from '#tests/helpers/planningPortableFixture.ts';

test.each(['marker', 'standards'])('refuses incomplete canonical transport authority: %s', (variant) => {
	const files = new Map<string, string>(variant === 'standards' ? [['planning-standards.json', '{}']] : []);
	expect(() => readPlanningTransport({ files, planningGeneration: variant === 'marker' ? 'a'.repeat(64) : undefined })).toThrow(
		'requires its canonical planning-record.json',
	);
});

test('refuses a marker naming another generation', async () => {
	const fixture = await planningPortableFixture();
	expect(() => readPlanningTransport({ files: fixture.files, name: fixture.name, planningGeneration: 'a'.repeat(64) })).toThrow(
		'marker and canonical generation disagree',
	);
});
