import type { PlanWorkspaceView } from '@lightsout/engine';
import { buildPlanWorkspaceListing } from '#tests/helpers/buildPlanWorkspaceListing.ts';

interface Params {
	/** Only what a test varies, over a drafted single-plan workspace with nothing parsed and nothing broken. */
	overrides?: Partial<PlanWorkspaceView>;
}

/** One plan workspace, shaped as `getPlanWorkspace` assembles it, with nothing in it a test did not ask for. */
export const buildPlanWorkspaceView = ({ overrides = {} }: Params = {}): PlanWorkspaceView => ({
	listing: buildPlanWorkspaceListing(),
	rootPath: '/repos/lightsout/.lightsout/plans/add-search',
	planFile: { name: 'plan.md', path: '.lightsout/plans/add-search/plan.md', bytes: 2048, updatedAt: '2026-01-01T00:00:00.000Z' },
	phaseFiles: [],
	transcripts: [],
	runs: [],
	problems: [],
	...overrides,
});
