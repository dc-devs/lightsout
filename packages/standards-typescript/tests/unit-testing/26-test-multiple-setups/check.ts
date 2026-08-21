import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readTestFiles } from '../../../common/checkInput/readTestFiles.ts';
import { buildLineSites } from '../../../common/findings/buildLineSites.ts';
import { buildRawFinding } from '../../../common/findings/buildRawFinding.ts';
import { blankStringsAndComments } from '../../../common/parsing/blankStringsAndComments.ts';
import { readCallBlocks } from '../../../common/parsing/readCallBlocks.ts';
import { getTestSubjectName } from '../../../common/paths/getTestSubjectName.ts';

/** A call to a `setup`-prefixed factory. */
const setupCall = /\bsetup[A-Za-z0-9_$]*\s*\(/g;

// A helper legitimately named `setupSomething` may be called by another
// factory, so this is a prompt to look rather than a violation — which is why
// the rule is advisory and says so in its guidance.
const multipleSetupsFindings = ({ file, text }: { file: string; text: string }) => {
	// In a setup factory's own test file, calling the subject is the ACT, not
	// arrangement — so it never counts toward the limit.
	const subject = getTestSubjectName({ test: file });
	// Counted over a body whose strings and comments are blanked out: a test
	// asserting on a message that MENTIONS `setup()` — which every rule about
	// setup factories has to — is not a test that calls one twice. Only the
	// counted body is blanked, never the text the block titles are read from.
	const arrangementCalls = (body: string) =>
		[...blankStringsAndComments({ text: body }).matchAll(setupCall)].filter(
			(match) => !match[0].startsWith(`${subject}(`) && !match[0].startsWith(`${subject} (`),
		);
	const overArranged = readCallBlocks({ text, callees: ['test', 'it'] }).filter((block) => arrangementCalls(block.body).length > 1);

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
