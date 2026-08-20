import type { StandardsFinding } from '@lightsout/engine';
import { StandardsSeverity } from '@lightsout/engine/contracts';

interface Params {
	rule?: string;
	severity?: StandardsFinding['severity'];
	/** The files the finding names, first one being the site that decides its folder. */
	paths?: string[];
	detail?: string;
	guidance?: string;
	siteKey?: string;
}

/** One open finding, shaped as a check emits it and the engine persists it, with only what a test cares about overridden. */
export const buildStandardsFinding = ({
	rule = 'size-file',
	severity = StandardsSeverity.Blocking,
	paths = ['packages/engine/src/plan/draftPlan.ts'],
	detail = '268 lines, cap is 250',
	guidance,
	siteKey = `${rule}:${paths[0] ?? '.'}`,
}: Params = {}): StandardsFinding => ({
	rule,
	severity,
	siteKey,
	files: paths.map((path) => ({ path })),
	detail,
	guidance,
});
