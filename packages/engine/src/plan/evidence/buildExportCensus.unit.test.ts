import { describe, expect, test } from '@jest/globals';
import { LightsoutConfig } from '#src/contracts/index.ts';
import { buildExportCensus } from '#src/plan/evidence/index.ts';
import { seedSourceRepo } from '#tests/helpers/seedSourceRepo.ts';

// No mocks: the subject walks a repo off disk, so the arrangement is a temp
// tree of one-export modules and the act is the real walk over it.

/** A temp repo holding the given existing source files, with the config a test needs to declare generated output. */
const setupCensusRepo = ({ existing, generated = [] }: { existing: string[]; generated?: string[] }) => {
	const cwd = seedSourceRepo({ existing });
	const config = LightsoutConfig.parse({
		gates: { check: 'true', test: 'true', 'test-coverage': false },
		generated,
	});

	return { cwd, config };
};

describe('buildExportCensus', () => {
	test('buildExportCensus: test files, index barrels and configured generated paths contribute no census entry', async () => {
		const { cwd, config } = setupCensusRepo({
			// each excluded file shares a name key with an ordinary one, so a broken
			// filter shows up as a second entry in that name's bucket rather than as
			// a bucket nothing else would have produced
			existing: ['src/formatDate.ts', 'src/getUser.ts', 'src/tests/formatDate.ts', 'src/feature/index.ts', 'generated-src/getUser.ts'],
			generated: ['generated-src/'],
		});

		const census = await buildExportCensus({ cwd, config });

		expect(Object.fromEntries(census)).toStrictEqual({
			'date format': [{ name: 'formatDate', path: 'src/formatDate.ts' }],
			'get user': [{ name: 'getUser', path: 'src/getUser.ts' }],
		});
	});

	test('buildExportCensus: an excluded path contributes no entry while its siblings still do', async () => {
		const { cwd, config } = setupCensusRepo({ existing: ['src/formatDate.ts', 'src/getUser.ts', 'src/parseThing.ts', 'src/renderCard.ts'] });

		const census = await buildExportCensus({ cwd, config, exclude: ['src/getUser.ts', 'src/formatDate.ts'] });

		// a plan's own created and emptied paths are subtracted so it cannot collide
		// with itself, and the subtraction never widens past what was named
		expect(Object.fromEntries(census)).toStrictEqual({
			'card render': [{ name: 'renderCard', path: 'src/renderCard.ts' }],
			'parse thing': [{ name: 'parseThing', path: 'src/parseThing.ts' }],
		});
	});
});
