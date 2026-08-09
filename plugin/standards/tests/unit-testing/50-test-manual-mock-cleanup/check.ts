import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildHookFinding } from '../../../common/utils/buildHookFinding.ts';
import { readCallBlocks } from '../../../common/utils/readCallBlocks.ts';
import { readTestFiles } from '../../../common/utils/readTestFiles.ts';

/** The manual cleanup a Jest config's `clearMocks`/`restoreMocks` already performs. */
const manualCleanup = /jest\.(?:clearAllMocks|resetAllMocks|restoreAllMocks)\s*\(|\.mock(?:Clear|Reset)\s*\(/;

export const check: StandardsCheckModule = {
	inputKind: 'test-file',
	// Hook bodies only, which is what makes the rule's own fallback structural:
	// the same `.mockReset()` at the top of a `setup()` factory is the prose's
	// advice for a package that cannot adopt the config, and never reaches here.
	run: ({ input }): RawStandardsFinding[] =>
		readTestFiles({ input }).flatMap(({ file, text }) =>
			buildHookFinding({
				rule: 'test-manual-mock-cleanup',
				file,
				blocks: readCallBlocks({ text, callees: ['beforeEach', 'beforeAll', 'afterEach', 'afterAll'] }),
				pattern: manualCleanup,
				detailSuffix: 'clears mocks by hand',
				guidance: "Mock cleanup belongs in the package's Jest config (`clearMocks`, `restoreMocks`), not in a per-file hook.",
			}),
		),
};
