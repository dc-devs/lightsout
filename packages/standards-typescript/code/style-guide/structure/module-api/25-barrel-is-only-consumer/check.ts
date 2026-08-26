import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildUnconsumedExportCheck } from '../../../../../common/checks/buildUnconsumedExportCheck.ts';

// Reached from a barrel and nothing else: the name is published, but no module
// ever imports it. That is either a deliberate public API or dead weight, which
// is why the verdict is advisory rather than a defect.
export const check: StandardsCheckModule = buildUnconsumedExportCheck({
	rule: 'barrel-is-only-consumer',
	matches: ({ barrel, test }) => barrel && !test,
	detail: 'exported through a barrel but no module consumes it',
	guidance: 'Deliberate public API, or dead? Only the author knows.',
});
