import { restoreBrainstormFiles } from '#src/brainstorm/index.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { restorePlanWorkspace } from '#src/plan/index.ts';
import { getTicketFolderPath } from '#src/ticket/common/utils/getTicketFolderPath.ts';
import { recordTicketSyncState } from '#src/ticket/common/utils/recordTicketSyncState.ts';
import { resolveTicketTrackerTarget } from '#src/ticket/common/utils/resolveTicketTrackerTarget.ts';

interface Params {
	/** The checkout the plan's own folder is written into. */
	cwd: string;
	/** The plan's address, `<ticket-branch>/<plan-id>`. */
	address: string;
	expectedMarker?: string;
	requireBrainstorm?: boolean;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	/**
	 * The checkout whose primary holds the ticket's record and sync sidecar.
	 * Defaults to `cwd`, and differs only when a plan is restored into a
	 * worktree while the record stays where the command was launched from.
	 */
	recordCwd?: string;
	onProgress?: (message: string) => void;
}

/** Remember which generation of this plan's files now sits on disk, so a later publish knows it is not behind. */
const recordMarker = async ({
	recordCwd,
	ticketBranch,
	planId,
	markerSha256,
	onProgress,
}: {
	recordCwd: string;
	ticketBranch: string;
	planId: string;
	markerSha256: string;
	onProgress?: (message: string) => void;
}) => {
	const stateDir = await resolveSharedStateDir({ cwd: recordCwd });
	const recorded = await recordTicketSyncState({
		ticketFolder: getTicketFolderPath({ stateDir, ticketBranch }),
		planMarkers: { [planId]: markerSha256 },
		failure: `plan ${planId} was restored, but this machine could not record which generation it took`,
	});

	if (recorded !== undefined) {
		onProgress?.(recorded.error);
	}
};

/**
 * Rebuild one plan of a ticket from the generations published under its own
 * plan id: the plan's durable files first, then the brainstorm generation that
 * owns `brainstorm-notes.md`.
 *
 * The plan generation decides the outcome and the brainstorm generation only
 * adds to it: a plan is complete without the notes, so a brainstorm that cannot
 * be verified is reported as a line and the restored plan stands. A ticket
 * carrying no generation for this plan is not a failure either — it is what a
 * plan that has never been published looks like — and no folder is created for
 * it.
 *
 * It does not pull the ticket record: the callers that need the record ask for
 * it themselves, and a restore that pulled would read the tracker twice for
 * every plan the queue restores.
 */
export const restoreTicketPlan = async ({
	cwd,
	address,
	config,
	env,
	recordCwd,
	onProgress,
	expectedMarker,
	requireBrainstorm,
}: Params): Promise<{ restored: string[] } | { error: string }> => {
	const parsed = parsePlanAddress({ name: address });

	if (parsed === undefined) {
		return {
			error: `'${address}' is not a plan address — a plan of a ticket is named as '<ticket-branch>/<plan-id>', for example 'lo-140-multi/001-search-basics'`,
		};
	}

	const { ticketBranch, planId } = parsed;
	const target = resolveTicketTrackerTarget({ config, env, ticketBranch });

	if ('error' in target) {
		return target;
	}

	if ('localOnly' in target) {
		return { error: `plan ${planId} cannot be restored: ${target.localOnly}` };
	}

	let stagedBrainstorm: Awaited<ReturnType<typeof restoreBrainstormFiles>> | undefined;
	const plan = await restorePlanWorkspace({
		cwd,
		name: address,
		identifier: target.ticketRef,
		settings: target.settings,
		titlePrefix: planId,
		expectedMarker,
		...(requireBrainstorm
			? {
					beforeExpose: async ({ directory }: { directory: string }) => {
						stagedBrainstorm = await restoreBrainstormFiles({
							cwd,
							name: address,
							identifier: target.ticketRef,
							settings: target.settings,
							titlePrefix: planId,
							directory,
						});
						if (stagedBrainstorm.error) throw new Error(stagedBrainstorm.error);
					},
				}
			: {}),
	});

	if (plan.error !== undefined) {
		return { error: plan.error };
	}

	if (plan.restored.length === 0 && !requireBrainstorm) {
		return { restored: [] };
	}

	const brainstorm =
		stagedBrainstorm ?? (await restoreBrainstormFiles({ cwd, name: address, identifier: target.ticketRef, settings: target.settings, titlePrefix: planId }));

	if (brainstorm.error !== undefined) {
		if (requireBrainstorm) return { error: brainstorm.error };
		onProgress?.(`plan ${planId} was restored, but its brainstorm generation was not: ${brainstorm.error}`);
	}

	if (plan.markerSha256 !== undefined) {
		await recordMarker({ recordCwd: recordCwd ?? cwd, ticketBranch, planId, markerSha256: plan.markerSha256, onProgress });
	}

	return { restored: [...plan.restored, ...brainstorm.restored].sort() };
};
