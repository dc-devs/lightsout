import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildUnconsumedFindings } from '../../../../common/utils/buildUnconsumedFindings.ts';
import { readFileTexts } from '../../../../common/utils/readFileTexts.ts';

export const check: StandardsCheckModule = {
	inputKind: 'file-text',
	// Reached from neither a barrel nor a test: nothing in the repo mentions the
	// name at all. The counting is conservative — a mention in a comment or a
	// string still counts as a reference — so calling a live export dead is rare,
	// which is what makes the verdict worth printing.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, contents } = readFileTexts({ input });

		return buildUnconsumedFindings({
			files,
			contents,
			rule: 'dead-export',
			matches: ({ barrel, test }) => !barrel && !test,
			detail: 'referenced nowhere else',
			guidance: 'A dead code candidate. Delete it — version control has the history.',
		});
	},
};
