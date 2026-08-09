import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildLineSites } from '../../../common/utils/buildLineSites.ts';
import { buildRawFinding } from '../../../common/utils/buildRawFinding.ts';
import { readCallBlocks } from '../../../common/utils/readCallBlocks.ts';
import { readTestFiles } from '../../../common/utils/readTestFiles.ts';

/** A call to a `setup`-prefixed factory. */
const setupCall = /\bsetup[A-Za-z0-9_$]*\s*\(/g;

// A helper legitimately named `setupSomething` may be called by another
// factory, so this is a prompt to look rather than a violation — which is why
// the rule is advisory and says so in its guidance.
const multipleSetupsFindings = ({ file, text }: { file: string; text: string }) => {
	const overArranged = readCallBlocks({ text, callees: ['test', 'it'] }).filter((block) => [...block.body.matchAll(setupCall)].length > 1);

	return overArranged.length === 0
		? []
		: [
				buildRawFinding({
					rule: 'test-multiple-setups',
					files: buildLineSites({ file, spans: overArranged }),
					detail: `${overArranged.map((block) => `'${block.title}' (line ${block.startLine})`).join(', ')} calls more than one setup factory`,
					guidance: 'Two setups means two tests. Heuristic — judge before acting.',
				}),
			];
};

export const check: StandardsCheckModule = {
	inputKind: 'test-file',
	run: ({ input }): RawStandardsFinding[] => readTestFiles({ input }).flatMap(multipleSetupsFindings),
};
