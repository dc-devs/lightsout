import { describe, expect, test } from '@jest/globals';

// Dependencies
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningPortableGeneration } from '#src/plan/workflow/common/types/transport/PlanningPortableGeneration.ts';
import { validatePlanningGeneration } from '#src/plan/workflow/store/index.ts';
import { planningPortableFixture as setup } from '#tests/helpers/planningPortableFixture.ts';

describe('validatePlanningGeneration', () => {
	test('rejects raw observation bodies in an otherwise hash-consistent portable bundle', async () => {
		const fixture = await setup();
		const portable = PlanningPortableGeneration.parse(JSON.parse(fixture.text));
		portable.omittedObservations = [];
		portable.artifacts.push({ path: fixture.observationPath, content: canonicalJson({ value: fixture.observation }) });
		const text = canonicalJson({ value: portable });

		expect(() => validatePlanningGeneration({ text, expectedDigest: sha256({ content: text }), name: fixture.name })).toThrow(
			'cannot include raw local observations',
		);
	});

	test.each(['missing-core', 'extra-omission', 'duplicate-omission', 'wrong-artifact', 'wrong-omission-hash', 'extra-artifact'])(
		'rejects incomplete or ambiguous portable authority: %s',
		async (defect) => {
			const fixture = await setup();
			const portable = PlanningPortableGeneration.parse(JSON.parse(fixture.text));
			if (defect === 'missing-core') portable.artifacts = portable.artifacts.filter((item) => item.path !== 'custom-data.json');
			if (defect === 'extra-omission')
				portable.omittedObservations.push({ ...portable.omittedObservations[0], path: `planning-observations/${'1'.repeat(64)}.json` });
			if (defect === 'duplicate-omission') portable.omittedObservations.push(portable.omittedObservations[0]);
			if (defect === 'wrong-artifact') portable.artifacts[0].content += ' changed';
			if (defect === 'wrong-omission-hash') portable.omittedObservations[0].sha256 = '1'.repeat(64);
			if (defect === 'extra-artifact') portable.artifacts.push({ path: 'extra.json', content: '{}' });
			const text = canonicalJson({ value: portable });

			expect(() => validatePlanningGeneration({ text, expectedDigest: sha256({ content: text }), name: fixture.name })).toThrow(/bijection|artifact|omission/);
		},
	);
});

test.each(['whitespace', 'name', 'record-digest', 'graph'])('rejects invalid portable identity or graph: %s', async (defect) => {
	const fixture = await setup();
	const portable = PlanningPortableGeneration.parse(JSON.parse(fixture.text));
	if (defect === 'record-digest') portable.generation = 'a'.repeat(64);
	if (defect === 'graph') {
		portable.record.work[0].prerequisiteIds = ['missing-work'];
		portable.generation = sha256({ content: canonicalJson({ value: portable.record }) });
	}
	const text = canonicalJson({ value: portable }) + (defect === 'whitespace' ? ' ' : '');
	expect(() => validatePlanningGeneration({ text, expectedDigest: sha256({ content: text }), name: defect === 'name' ? 'other' : fixture.name })).toThrow(
		defect === 'graph' ? 'Invalid portable planning graph' : 'invalid identity',
	);
});
