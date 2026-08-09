import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildUnconsumedFindings } from '../../../../../common/utils/buildUnconsumedFindings.ts';
import { readFileTexts } from '../../../../../common/utils/readFileTexts.ts';

export const check: StandardsCheckModule = {
	inputKind: 'file-text',
	// Reached from a barrel and nothing else: the name is published, but no
	// module ever imports it. That is either a deliberate public API or dead
	// weight, which is why the verdict is advisory rather than a defect.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, contents } = readFileTexts({ input });

		return buildUnconsumedFindings({
			files,
			contents,
			rule: 'barrel-only-export',
			matches: ({ barrel, test }) => barrel && !test,
			detail: 'exported through a barrel but no module consumes it',
			guidance: 'Deliberate public API, or dead? Only the author knows.',
		});
	},
};
