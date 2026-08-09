import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildHookFinding } from '../../../common/utils/buildHookFinding.ts';
import { readCallBlocks } from '../../../common/utils/readCallBlocks.ts';
import { readTestFiles } from '../../../common/utils/readTestFiles.ts';

/** An assertion. */
const assertion = /\bexpect\s*\(/;

export const check: StandardsCheckModule = {
	inputKind: 'test-file',
	// `beforeEach` only, the single hook the rule names — an `expect` in an
	// `afterEach` is an ordinary leak check the prose never bans.
	run: ({ input }): RawStandardsFinding[] =>
		readTestFiles({ input }).flatMap(({ file, text }) =>
			buildHookFinding({
				rule: 'test-assert-in-hook',
				file,
				blocks: readCallBlocks({ text, callees: ['beforeEach'] }),
				pattern: assertion,
				detailSuffix: 'asserts',
				guidance: 'Act and assert live in the `test`; a hook only arranges.',
			}),
		),
};
