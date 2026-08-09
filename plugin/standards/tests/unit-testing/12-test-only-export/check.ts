import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildUnconsumedFindings } from '../../../common/utils/buildUnconsumedFindings.ts';
import { readFileTexts } from '../../../common/utils/readFileTexts.ts';

export const check: StandardsCheckModule = {
	inputKind: 'file-text',
	// An export reached from BOTH a barrel and a test is deliberate public API
	// whose contract the tests pin — the prose says so outright — so only the
	// test-and-nothing-else case is reported.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, contents } = readFileTexts({ input });

		return buildUnconsumedFindings({
			files,
			contents,
			rule: 'test-only-export',
			matches: ({ barrel, test }) => test && !barrel,
			detail: 'referenced only by tests',
			guidance: 'A production-dead candidate: only its own tests keep it alive.',
		});
	},
};
