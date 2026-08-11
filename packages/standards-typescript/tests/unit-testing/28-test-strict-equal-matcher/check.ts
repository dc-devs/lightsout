import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { blankStringsAndComments } from '../../../common/utils/blankStringsAndComments.ts';
import { buildLineSites } from '../../../common/utils/buildLineSites.ts';
import { buildRawFinding } from '../../../common/utils/buildRawFinding.ts';
import { readCallBlocks } from '../../../common/utils/readCallBlocks.ts';
import { readTestFiles } from '../../../common/utils/readTestFiles.ts';

/** An asymmetric matcher: with one of these as its argument, `toStrictEqual` runs the matcher and nothing else. */
const asymmetricMatcher = /expect\.(?:objectContaining|arrayContaining|any|stringContaining|stringMatching)\s*\(/;

const strictEqualFindings = ({ file, text }: { file: string; text: string }) => {
	// Read with strings, templates and comments emptied out: a test whose sample
	// data quotes a matcher is describing one, not using one. Positions are
	// unchanged, so the blocks found sit on the file's own lines — and this rule
	// reads only their bodies, never the titles the blanking takes with it.
	const misleading = readCallBlocks({ text: blankStringsAndComments({ text }), callees: ['toStrictEqual'] }).filter((block) =>
		asymmetricMatcher.test(block.body),
	);

	return misleading.length === 0
		? []
		: [
				buildRawFinding({
					rule: 'test-strict-equal-matcher',
					files: buildLineSites({ file, spans: misleading }),
					detail: `toStrictEqual with an asymmetric matcher at line(s) ${misleading.map((block) => block.startLine).join(', ')}`,
					guidance: 'Jest runs only the matcher, so the strict extra-property checks never fire — write `toEqual`, or assert a concrete object.',
				}),
			];
};

export const check: StandardsCheckModule = {
	inputKind: 'test-file',
	run: ({ input }): RawStandardsFinding[] => readTestFiles({ input }).flatMap(strictEqualFindings),
};
