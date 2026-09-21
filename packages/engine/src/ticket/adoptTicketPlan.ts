import { mkdir, rename, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { restoreBrainstormFiles } from '#src/brainstorm/index.ts';
import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import { type LightsoutConfig, type RunManifest, RunStatus, TicketEventKind, type TicketRecord } from '#src/contracts/index.ts';
import { planWorkspaceDir, planWorkspacePath, resolvePlanDeliverable, restorePlanWorkspace } from '#src/plan/index.ts';
import { findLiveRunRefusal } from '#src/ticket/common/adoption/findLiveRunRefusal.ts';
import { readAdoptedProgress } from '#src/ticket/common/adoption/readAdoptedProgress.ts';
import { readFolderRuns } from '#src/ticket/common/adoption/readFolderRuns.ts';
import { appendTicketEvent } from '#src/ticket/common/record/appendTicketEvent.ts';
import { buildTicketRecord } from '#src/ticket/common/record/buildTicketRecord.ts';
import { composePlanId } from '#src/ticket/common/record/composePlanId.ts';
import type { TicketRecordChange } from '#src/ticket/common/types/TicketRecordChange.ts';
import { listLegacyPlanEntries } from '#src/ticket/common/utils/listLegacyPlanEntries.ts';
import { resolveTicketTrackerTarget } from '#src/ticket/common/utils/resolveTicketTrackerTarget.ts';
import { pullTicketRecord } from '#src/ticket/pullTicketRecord.ts';
import { updateSyncedTicketRecord } from '#src/ticket/updateSyncedTicketRecord.ts';

interface Params {
	/** Any checkout of the repository: the folder that is adopted is always the PRIMARY checkout's. */
	cwd: string;
	ticketBranch: string;
	/** The slug plan 001's folder and attachment titles carry for the rest of the ticket's life. */
	slug: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/** Everything a refusal is decided from, gathered before a single file moves: the plans folder's own files become plan 001's, and `born` is the empty record this ticket's is built out of. */
interface AdoptionSubject {
	primaryCheckout: string;
	plansFolder: string;
	entries: string[];
	runs: RunManifest[];
	planId: string;
	born: TicketRecord;
}

/**
 * The ticket's bare-title generations, written into the primary checkout's
 * ticket folder so a machine that never held the folder can still adopt it.
 * The plan generation goes first: its write exposes a whole folder with one
 * rename, and so needs the folder empty.
 */
const restoreBareGenerations = async ({ params, primaryCheckout }: { params: Params; primaryCheckout: string }): Promise<{ error: string } | undefined> => {
	const { ticketBranch, config, env } = params;
	const target = resolveTicketTrackerTarget({ config, env, ticketBranch });

	if ('localOnly' in target) {
		return undefined;
	}

	if ('error' in target) {
		return target;
	}

	const { settings, ticketRef: identifier } = target;
	const plan = await restorePlanWorkspace({ cwd: primaryCheckout, name: ticketBranch, identifier, settings });

	if (plan.error !== undefined) {
		return { error: plan.error };
	}

	const brainstorm = await restoreBrainstormFiles({ cwd: primaryCheckout, name: ticketBranch, identifier, settings });

	return brainstorm.error === undefined ? undefined : { error: brainstorm.error };
};

/** Move the plans folder's own files into plan 001's folder, reporting how far it got so a failure can be undone. */
const movePlanEntries = async ({ plansFolder, planFolder, entries }: { plansFolder: string; planFolder: string; entries: string[] }) => {
	const moved: string[] = [];
	let error: string | undefined;

	try {
		await mkdir(planFolder, { recursive: true });

		for (const entry of entries) {
			await rename(join(plansFolder, entry), join(planFolder, entry));
			moved.push(entry);
		}
	} catch (failure) {
		error = `the files of '${plansFolder}' could not be moved into ${planFolder}: ${messageOf({ error: failure })}`;
	}

	return { moved, error };
};

/** Put the folder back exactly as it was found. The removal is never recursive: a file left here is the human's work, not this command's to delete. */
const undoMovedEntries = async ({ plansFolder, planFolder, moved }: { plansFolder: string; planFolder: string; moved: string[] }) => {
	for (const entry of moved) {
		await rename(join(planFolder, entry), join(plansFolder, entry)).catch(() => undefined);
	}

	await rmdir(planFolder).catch(() => undefined);
};

/** What to do next: publish the adopted plan, and finish an implementation the move took out of reach. */
const describeAdoption = ({ address, planId, hasDeliverable, runs }: { address: string; planId: string; hasDeliverable: boolean; runs: RunManifest[] }) => {
	const sentences = [
		...(hasDeliverable
			? [`the adopted files are not published under plan ${planId}'s own titles yet — run \`lightsout plan publish --name ${address}\`.`]
			: []),
		...(runs.some((manifest) => manifest.status !== RunStatus.Passed)
			? [
					`the earlier runs of this folder can no longer be resumed through their old plan path now that its files have moved — finish plan ${planId}'s implementation with \`lightsout implement --plan ${planWorkspacePath({ name: address })}\`.`,
				]
			: []),
	];

	return sentences.length === 0 ? undefined : sentences.join(' ');
};

/** The folder as it must be before it may be adopted, or the one sentence saying why it may not. */
const resolveAdoptionSubject = async (params: Params): Promise<AdoptionSubject | { error: string }> => {
	const { cwd, ticketBranch, slug, config, env, onProgress } = params;
	const pulled = await pullTicketRecord({ cwd, ticketBranch, config, env, onProgress });

	if ('error' in pulled) {
		return pulled;
	}

	if (pulled.record !== undefined) {
		return { error: `ticket ${ticketBranch} already has a record holding ${pulled.record.plans.length} plan(s), so there is no single-folder plan to adopt` };
	}

	const composed = composePlanId({ number: 1, slug });
	const born = buildTicketRecord({ ticketBranch, config });

	if ('error' in composed) {
		return composed;
	}

	if ('error' in born) {
		return born;
	}

	const primaryCheckout = dirname(await resolveSharedStateDir({ cwd }));
	const plansFolder = await planWorkspaceDir({ cwd, name: ticketBranch });
	const onDisk = await listLegacyPlanEntries({ plansFolder });
	const restored = onDisk.length === 0 ? await restoreBareGenerations({ params, primaryCheckout }) : undefined;

	if (restored !== undefined) {
		return restored;
	}

	const entries = onDisk.length === 0 ? await listLegacyPlanEntries({ plansFolder }) : onDisk;

	if (entries.length === 0) {
		return {
			error: `the plan folder '${ticketBranch}' holds no files of a single-folder plan, on this machine or on its ticket, so there is nothing to adopt`,
		};
	}

	const runs = await readFolderRuns({ primaryCheckout, ticketBranch });
	const live = await findLiveRunRefusal({ primaryCheckout, runs });

	return live === undefined ? { primaryCheckout, plansFolder, entries, runs, planId: composed.id, born } : { error: live };
};

/**
 * Turn the primary checkout's single-folder plan into plan 001 of a new ticket
 * record — the one-time, explicit conversion, since nothing migrates a folder
 * by itself. Every refusal is decided before a file moves and a part-way move
 * is put back, so the folder is wholly adopted or exactly as it was found.
 */
export const adoptTicketPlan = async (params: Params): Promise<(TicketRecordChange & { address: string }) | { error: string }> => {
	const subject = await resolveAdoptionSubject(params);

	if ('error' in subject) {
		return subject;
	}

	const { cwd, ticketBranch, slug, config, env, onProgress } = params;
	const { primaryCheckout, plansFolder, entries, runs, planId, born } = subject;
	const address = formatPlanAddress({ ticketBranch, planId });
	const hasDeliverable = (await resolvePlanDeliverable({ cwd: primaryCheckout, name: ticketBranch })).error === undefined;
	const at = new Date().toISOString();
	const adopted = appendTicketEvent({
		record: { ...born, plans: [{ id: planId, title: slug, progress: readAdoptedProgress({ runs, hasDeliverable }), createdAt: at }] },
		kind: TicketEventKind.PlanAdopted,
		detail: `the single-folder plan of ${ticketBranch} was adopted as plan ${planId}`,
		at,
	});
	const planFolder = join(plansFolder, planId);
	const appeared = `a ticket record for ${ticketBranch} appeared while its folder was being adopted, so nothing was changed`;
	const { moved, error: moveError } = await movePlanEntries({ plansFolder, planFolder, entries });
	const written =
		moveError === undefined
			? await updateSyncedTicketRecord({
					cwd,
					ticketBranch,
					config,
					env,
					onProgress,
					change: (current) => (current === undefined ? adopted : { error: appeared }),
				})
			: { error: moveError };

	if ('error' in written) {
		await undoMovedEntries({ plansFolder, planFolder, moved });

		return written;
	}

	return { address, record: written.record, notice: describeAdoption({ address, planId, hasDeliverable, runs }), publishError: written.publishError };
};
