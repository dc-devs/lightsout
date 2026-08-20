import type { StandardsView } from '@lightsout/engine';
import { buildStandardsRuleView } from '#tests/helpers/buildStandardsRuleView.ts';

interface Params {
	/** Only what a test varies, over a repo that has run one check over its whole tree. */
	overrides?: Partial<StandardsView>;
}

/** The standards view's whole payload, shaped as the engine assembles it, with nothing in it a test did not ask for. */
export const buildStandardsView = ({ overrides = {} }: Params = {}): StandardsView => ({
	at: '2026-01-01T00:00:00.000Z',
	path: '.',
	notes: [],
	findings: [],
	rules: [buildStandardsRuleView()],
	trend: [],
	totals: { rules: 1, checked: 1, judgment: 0, blocking: 0, advisory: 0, orphans: 0 },
	...overrides,
});
