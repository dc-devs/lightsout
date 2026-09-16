import { restoreBrainstormFiles } from '#src/brainstorm/index.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { pathExists, planWorkspaceDir, readPlanningEntrySnapshot } from '#src/plan/index.ts';
import { restoreTicketPlan } from '#src/ticket/index.ts';
import { resolveTrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	planAddress: string;
	identifier: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	expectedMarker?: string;
	onProgress?: (message: string) => void;
}

/** Recover remote authority before creating local canonical state; existing canonical continuations retain their own history. */
export const restorePlanningSession = async ({ cwd, planAddress, identifier, config, env, expectedMarker, onProgress }: Params): Promise<void> => {
	if (await readPlanningEntrySnapshot({ cwd, name: planAddress })) return;
	const folder = planWorkspaceDir({ cwd, name: planAddress });
	if (expectedMarker !== undefined || !(await pathExists({ path: folder }))) {
		const restored = await restoreTicketPlan({ cwd, address: planAddress, config, env, expectedMarker, requireBrainstorm: true, onProgress });
		if ('error' in restored) throw new Error(restored.error);
	} else {
		const settings = resolveTrackerSettings({ config, env });
		if ('error' in settings) throw new Error(settings.error);
		const address = parsePlanAddress({ name: planAddress });
		if (!address) throw new Error('Queue planning requires an exact ticket plan address');
		const restored = await restoreBrainstormFiles({ cwd, name: planAddress, identifier, settings, titlePrefix: address.planId });
		if (restored.error) throw new Error(restored.error);
	}
};
