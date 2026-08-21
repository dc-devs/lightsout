import type { StandardsRuleView } from '@lightsout/engine';
import { StandardsSet, StandardsSeverity } from '@lightsout/engine/contracts';

interface Params {
	rule?: string;
	checked?: boolean;
	severity?: StandardsRuleView['severity'];
	fromConfig?: boolean;
	settings?: Record<string, number>;
	findingCount?: number;
	prose?: string;
	history?: Partial<StandardsRuleView['history']>;
}

/** One rule's row, joined as `getStandardsView` joins it, over a rule nothing remarkable has happened to. */
export const buildStandardsRuleView = ({
	rule = 'size-file',
	checked = true,
	severity = StandardsSeverity.Blocking,
	fromConfig = false,
	settings = { file: 250 },
	findingCount = 0,
	prose = 'Files stay under ~250 lines.',
	history = {},
}: Params = {}): StandardsRuleView => ({
	rule,
	doc: '@lightsout/standards-typescript: code/style-guide/patterns/functions',
	documentPath: 'code/style-guide/patterns/functions',
	set: StandardsSet.Code,
	summary: 'a file over the standards line cap',
	prose,
	checked,
	severity,
	fromConfig,
	settings,
	findingCount,
	history: { attempted: 0, resolved: 0, declined: 0, untracked: 0, adviceApplied: 0, adviceDeclined: 0, adviceAlreadyMet: 0, reasons: [], ...history },
});
