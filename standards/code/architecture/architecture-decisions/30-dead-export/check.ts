import type { StandardsCheckModule } from '@/contracts';
import { buildUnconsumedExportCheck } from '../../../../common/utils/buildUnconsumedExportCheck.ts';

// Reached from neither a barrel nor a test: nothing in the repo mentions the
// name at all. The counting is conservative — a mention in a comment or a
// string still counts as a reference — so calling a live export dead is rare,
// which is what makes the verdict worth printing.
export const check: StandardsCheckModule = buildUnconsumedExportCheck({
	rule: 'dead-export',
	matches: ({ barrel, test }) => !barrel && !test,
	detail: 'referenced nowhere else',
	guidance: 'A dead code candidate. Delete it — version control has the history.',
});
