import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildUnconsumedExportCheck } from '../../../../common/checks/buildUnconsumedExportCheck.ts';

// Nothing in the repo mentions the name — a folder barrel listing it aside,
// since nothing imports through one. The counting is conservative — a mention in a comment or a
// string still counts as a reference — so calling a live export dead is rare,
// which is what makes the verdict worth printing.
export const check: StandardsCheckModule = buildUnconsumedExportCheck({
	rule: 'dead-export',
	matches: ({ test }) => !test,
	detail: 'referenced nowhere else',
	guidance: 'A dead code candidate. Delete it — version control has the history.',
});
