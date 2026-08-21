import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildHookContentCheck } from '../../../common/checks/buildHookContentCheck.ts';

/** The manual cleanup a Jest config's `clearMocks`/`restoreMocks` already performs. */
const manualCleanup = /jest\.(?:clearAllMocks|resetAllMocks|restoreAllMocks)\s*\(|\.mock(?:Clear|Reset)\s*\(/;

// Hook bodies only, which is what makes the rule's own fallback structural: the
// same `.mockReset()` at the top of a `setup()` factory is the prose's advice
// for a package that cannot adopt the config, and never reaches here.
export const check: StandardsCheckModule = buildHookContentCheck({
	rule: 'test-manual-mock-cleanup',
	hooks: ['beforeEach', 'beforeAll', 'afterEach', 'afterAll'],
	pattern: manualCleanup,
	detailSuffix: 'clears mocks by hand',
	guidance: "Mock cleanup belongs in the package's Jest config (`clearMocks`, `restoreMocks`), not in a per-file hook.",
});
