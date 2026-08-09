import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildLineSites } from '../../../common/utils/buildLineSites.ts';
import { buildRawFinding } from '../../../common/utils/buildRawFinding.ts';
import { readCallBlocks } from '../../../common/utils/readCallBlocks.ts';
import { readTestFiles } from '../../../common/utils/readTestFiles.ts';

/** The closed nesting exception the rule names: a nested describe titling a condition or a variant. */
const nestingException = /^(when|for)\s/;

const nestedDescribeFindings = ({ file, text }: { file: string; text: string }) => {
	const nested = readCallBlocks({ text, callees: ['describe'] }).filter((block) => block.depth > 0 && !nestingException.test(block.title));

	return nested.length === 0
		? []
		: [
				buildRawFinding({
					rule: 'test-nested-describe',
					files: buildLineSites({ file, spans: nested }),
					detail: `${nested.map((block) => `'${block.title}' (line ${block.startLine})`).join(', ')} nested inside another describe`,
					guidance: 'Keep describe blocks flat — scenario variants come from `setup()` parameters, or from a `when …` / `for …` title.',
				}),
			];
};

export const check: StandardsCheckModule = {
	inputKind: 'test-file',
	run: ({ input }): RawStandardsFinding[] => readTestFiles({ input }).flatMap(nestedDescribeFindings),
};
