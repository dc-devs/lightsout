import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildUnconsumedExportCheck } from '../../../common/checks/buildUnconsumedExportCheck.ts';

// Tests are the only mention: a package entry listing the name would have
// counted as a use, since other packages read it, so a name the package
// publishes is never reported here.
export const check: StandardsCheckModule = buildUnconsumedExportCheck({
	rule: 'test-only-export',
	matches: ({ test }) => test,
	detail: 'referenced only by tests',
	guidance: 'A production-dead candidate: only its own tests keep it alive.',
});
