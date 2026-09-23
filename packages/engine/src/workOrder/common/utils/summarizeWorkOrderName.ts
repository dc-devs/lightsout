import { buildWorkOrderNameInvocation } from '#src/agents/index.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { toBranchSlug } from '#src/common/utils/toBranchSlug.ts';
import { type LightsoutConfig, Permissions, WorkOrderName } from '#src/contracts/index.ts';
import { type Driver, getDriver } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/index.ts';

interface Params {
	/** The checkout the harness is spawned in. The call reads nothing from it, but every spawn needs a working directory. */
	cwd: string;
	/** The tracker's own spelling of the ticket reference the title belongs to. */
	ticketRef: string;
	/** The ticket's title, as the tracker holds it. */
	title: string;
	config: LightsoutConfig;
	/** Test seam for the one agent call — defaults to the harness the config names. */
	driver?: Driver;
	onProgress?: (message: string) => void;
}

/**
 * The words a work order's label carries, summarised from its ticket's title
 * by the repository's own harness.
 *
 * A read-only one-shot with a fixed two-minute ceiling — the same ceiling the
 * doctor's throwaway call takes, and for the same reason: long enough for a few
 * words from a cold harness, short enough that a hang never holds a command
 * that has written nothing yet. It grants no commands, because the call reads a
 * string and answers a string.
 */
const readSummary = async ({
	cwd,
	ticketRef,
	title,
	config,
	driver,
}: {
	cwd: string;
	ticketRef: string;
	title: string;
	config: LightsoutConfig;
	driver?: Driver;
}) => {
	const timeoutMs = 120_000;

	try {
		return await invokeAgentWithContract({
			driver: driver ?? getDriver({ name: config.harness ?? 'claude-code' }),
			cwd,
			invocation: buildWorkOrderNameInvocation({ ticketRef, title }),
			contract: WorkOrderName,
			model: config.model,
			effort: config.effort,
			permissions: Permissions.ReadOnly,
			timeoutMs,
		});
	} catch (error) {
		return { ok: false as const, failure: messageOf({ error }) };
	}
};

/**
 * Three or four words naming the work, summarised from the ticket's title.
 *
 * It answers a string and never an error arm. Every failure — a driver that
 * throws, a rate-limited harness, an answer the contract refuses twice — falls
 * back to the mechanical cut of the title and narrates that through
 * `onProgress`. The asymmetry is the point: the name is a label, and a command
 * that refused to create a work order because a model call timed out would be
 * worse than a mechanically cut one.
 */
export const summarizeWorkOrderName = async ({ cwd, ticketRef, title, config, driver, onProgress }: Params): Promise<string> => {
	onProgress?.(`summarising the title of ${ticketRef} into a work order name`);

	const outcome = await readSummary({ cwd, ticketRef, title, config, driver });
	let words = toBranchSlug({ text: title });

	if (outcome.ok) {
		words = outcome.report.words;
	} else {
		onProgress?.(`the harness did not name this work (${outcome.failure}) — using '${words}', cut mechanically from the ticket's title`);
	}

	return words;
};
