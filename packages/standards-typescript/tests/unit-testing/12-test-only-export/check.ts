import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildUnconsumedExportCheck } from '../../../common/utils/buildUnconsumedExportCheck.ts';

// An export reached from BOTH a barrel and a test is deliberate public API
// whose contract the tests pin — the prose says so outright — so only the
// test-and-nothing-else case is reported.
export const check: StandardsCheckModule = buildUnconsumedExportCheck({
	rule: 'test-only-export',
	matches: ({ barrel, test }) => test && !barrel,
	detail: 'referenced only by tests',
	guidance: 'A production-dead candidate: only its own tests keep it alive.',
});
