import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildHookFinding } from '../../../common/utils/buildHookFinding.ts';
import { readCallBlocks } from '../../../common/utils/readCallBlocks.ts';
import { readTestFiles } from '../../../common/utils/readTestFiles.ts';

/** The four return-value setters the rule names. The `*Once` variants are deliberately absent — the prose does not name them. */
const returnSetter = /\.mock(?:ReturnValue|ResolvedValue|RejectedValue|Implementation)\s*\(/;

export const check: StandardsCheckModule = {
	inputKind: 'test-file',
	// `beforeEach` only, the single hook the rule names — and the sanctioned home
	// for a return value is the `setup()` factory, which is not a hook at all.
	run: ({ input }): RawStandardsFinding[] =>
		readTestFiles({ input }).flatMap(({ file, text }) =>
			buildHookFinding({
				rule: 'test-mock-return-in-hook',
				file,
				blocks: readCallBlocks({ text, callees: ['beforeEach'] }),
				pattern: returnSetter,
				detailSuffix: 'sets a mock return value',
				guidance: 'Set mock return values in the `setup()` factory, so each test states its own arrangement.',
			}),
		),
};
