import type { StandardsPackRuleListing } from '@lightsout/engine';
import { StandardsSet, StandardsSeverity } from '@lightsout/engine/contracts';

interface Params {
	id?: string;
	set?: StandardsSet;
	documentPath?: string;
	summary?: string;
	channel?: string;
	checked?: boolean;
	defaultSeverity?: typeof StandardsSeverity.Blocking | typeof StandardsSeverity.Advisory;
	defaultSettings?: Record<string, number>;
	fixtureCounts?: { pass: number; fail: number };
}

/** One rule's row, as a pack's view lists it — an ordinary checked rule with both sides of its proof. */
export const buildStandardsPackRuleListing = ({
	id = 'type-assertion',
	set = StandardsSet.Code,
	documentPath = 'code/style-guide/typescript/type-assertions',
	summary = 'an `as` cast where narrowing would do',
	channel = 'base',
	checked = true,
	defaultSeverity = StandardsSeverity.Blocking,
	defaultSettings = {},
	fixtureCounts = { pass: 1, fail: 1 },
}: Params = {}): StandardsPackRuleListing => ({
	id,
	set,
	documentPath,
	summary,
	channel,
	checked,
	defaultSeverity,
	defaultSettings,
	fixtureCounts,
});
