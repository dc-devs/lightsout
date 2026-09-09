import { messageOf } from '#src/common/utils/messageOf.ts';
import type { GateHold, LightsoutConfig } from '#src/contracts/index.ts';
import { writeGateBlockedLabel } from '#src/gates/gateHolds/common/utils/writeGateBlockedLabel.ts';
import { writeGateHold } from '#src/gates/gateHolds/common/utils/writeGateHold.ts';
import { resolveTrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	/** The checkout the stopped run works in, from which the shared holds folder is resolved. */
	cwd: string;
	config: LightsoutConfig;
	/**
	 * The process environment the tracker credentials are read from. Defaulted
	 * rather than required, because `stopOnGateCoordination` ends a pipeline run
	 * holding a `cwd`, a `config` and a manifest, and no process environment
	 * anywhere in its call chain. A default still lets every test pass its own.
	 */
	env?: NodeJS.ProcessEnv;
	ticketRef: string | undefined;
	runId: string;
	worktreePath: string;
	/** The coordination sentence the wait expiry produced, recorded as the hold's reason. */
	reason: string;
	onProgress?: (message: string) => void;
}

/** The hold on disk, or the sentence saying this machine could not record it. */
const recordHold = async ({ cwd, identifier, hold }: { cwd: string; identifier: string; hold: GateHold }) => {
	try {
		await writeGateHold({ cwd, identifier, hold });

		return undefined;
	} catch (error) {
		return `the gate hold for ${identifier} could not be recorded on this machine: ${messageOf({ error })}`;
	}
};

/**
 * The durable hold a coordination failure takes on ticket-backed work: the
 * local record first, then the tracker label.
 *
 * The ordering is the contract. The record is written unconfirmed BEFORE the
 * tracker is asked and rewritten confirmed only once the write has landed, so a
 * process killed between the two still leaves a hold nothing walks past — and a
 * label that never landed is never later read as a human releasing the ticket.
 *
 * It reads no other hold and writes no file but its own ticket's, which is what
 * keeps two workers timing out in the same second from losing each other's.
 *
 * Exactly two situations take no hold: a repository with no `ticket-tracker`
 * block, and a run with no ticket reference. There is no label to write and no
 * refusal site that could read one. Every other tracker failure — a missing
 * credential above all — still records the hold unconfirmed, because letting a
 * fully configured repository time out and record nothing is the silent
 * pass-through this hold exists to stop.
 *
 * @returns undefined when the hold is fully recorded, or one sentence naming what could not be
 */
export const takeGateHold = async ({
	cwd,
	config,
	env = process.env,
	ticketRef,
	runId,
	worktreePath,
	reason,
	onProgress,
}: Params): Promise<string | undefined> => {
	if (ticketRef === undefined || config['ticket-tracker'] === undefined) {
		return undefined;
	}

	const hold: GateHold = { takenAt: new Date().toISOString(), runId, worktreePath, reason, labelConfirmed: false };
	const failures = [await recordHold({ cwd, identifier: ticketRef, hold })];
	const settings = resolveTrackerSettings({ config, env });

	if ('error' in settings) {
		failures.push(`the '${ticketRef}' hold was recorded on this machine but not on the tracker: ${settings.error}`);
	} else {
		const labelFailure = await writeGateBlockedLabel({ settings, identifier: ticketRef });

		failures.push(labelFailure);

		if (labelFailure === undefined) {
			failures.push(await recordHold({ cwd, identifier: ticketRef, hold: { ...hold, labelConfirmed: true } }));
		}
	}

	const named = failures.filter((failure) => failure !== undefined);

	for (const failure of named) {
		onProgress?.(`${ticketRef} · ${failure}`);
	}

	return named.length === 0 ? undefined : named.join(' ');
};
