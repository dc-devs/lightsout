import { buildCommitMessageInvocation } from '#src/agents/buildCommitMessageInvocation.ts';
import { buildRunCommitMessage } from '#src/commit/internal/buildRunCommitMessage.ts';
import type { CommitAddress } from '#src/commit/internal/common/types/CommitAddress.ts';
import { readGitStagedChange } from '#src/common/git/readGitStagedChange.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { Permissions } from '#src/contracts/Permissions.ts';
import type { AgentUsage } from '#src/contracts/run/AgentUsage.ts';
import { CommitMessage } from '#src/contracts/work/CommitMessage.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { invokeAgentWithContract } from '#src/invoke/invokeAgentWithContract.ts';

interface Params {
	/** The worktree whose staged change is described — the one the commit is made in. */
	cwd: string;
	/** The harness the calling pipeline or queue already holds. */
	driver: Driver;
	/** Supplies the model and effort. */
	config: LightsoutConfig;
	address: CommitAddress;
	/** The lightsout run named on the body's last line. Absent only for a leftover plan with no recorded run, whose message then names none. */
	runId?: string;
	/** Called once with the agent call's usage whenever the agent was invoked — the pipelines bill it to the run; the queue omits it. */
	onUsage?: ({ usage }: { usage?: AgentUsage }) => Promise<void>;
	onProgress?: (message: string) => void;
}

/**
 * The agent's answer about one staged change.
 *
 * A read-only one-shot with a fixed three-minute ceiling — longer than the
 * work-order namer's, because this call reads a diff rather than a title. It
 * grants no commands: the diff is handed over in the prompt, so there is nothing
 * for the agent to look up.
 */
const askForSummary = async ({
	cwd,
	driver,
	config,
	address,
	change,
}: {
	cwd: string;
	driver: Driver;
	config: LightsoutConfig;
	address: CommitAddress;
	change: { stat: string; diff: string; truncated: boolean };
}) => {
	const timeoutMs = 180_000;

	try {
		return await invokeAgentWithContract({
			driver,
			cwd,
			invocation: buildCommitMessageInvocation({ reference: address.reference, context: address.context, ...change }),
			contract: CommitMessage,
			model: config.model,
			effort: config.effort,
			permissions: Permissions.ReadOnly,
			timeoutMs,
		});
	} catch (error) {
		return { ok: false as const, failure: messageOf({ error }), usage: undefined };
	}
};

/**
 * The summary with a leading copy of the reference taken off, so the subject
 * names the ticket exactly once.
 *
 * The reference is compared as a literal string, never built into a pattern —
 * a run-label fallback can hold pattern characters — and only as a whole token:
 * it must be followed by a colon, whitespace or the end of the summary, so a
 * summary opening on a longer ticket such as `LO-1670` is left as it is.
 */
const stripReference = ({ summary, reference }: { summary: string; reference: string }) => {
	const rest = summary.slice(reference.length);
	const repeats = reference !== '' && summary.slice(0, reference.length).toLowerCase() === reference.toLowerCase() && /^(?::|\s|$)/u.test(rest);

	return (repeats ? rest.replace(/^\s*:?\s*/u, '') : summary).trim();
};

/**
 * The summary and body the agent wrote for the staged change, or why there are
 * none. An index nobody could read never reaches the agent: there would be
 * nothing for it to describe.
 */
const readAnswer = async ({
	cwd,
	driver,
	config,
	address,
	onUsage,
}: {
	cwd: string;
	driver: Driver;
	config: LightsoutConfig;
	address: CommitAddress;
	onUsage?: ({ usage }: { usage?: AgentUsage }) => Promise<void>;
}) => {
	const maxDiffLength = 60_000;
	const change = await readGitStagedChange({ cwd, maxDiffLength });

	if (change === undefined) {
		return { failure: `the staged change in ${cwd} could not be read, so no agent described it` };
	}

	const outcome = await askForSummary({ cwd, driver, config, address, change });

	await onUsage?.({ usage: outcome.usage });

	if (!outcome.ok) {
		return { failure: `the harness did not describe this commit (${outcome.failure})` };
	}

	const summary = stripReference({ summary: outcome.report.summary, reference: address.reference });

	return summary === '' ? { failure: `the harness's summary only repeated ${address.reference}` } : { summary, body: outcome.report.body };
};

/**
 * The message one commit is made under, written from what is staged: the
 * agent's summary behind the engine's reference, then the agent's body and the
 * trailer lines.
 *
 * It answers a message and never an error arm. Every failure — an index that
 * cannot be read, a driver that throws, an answer the contract refuses twice, a
 * summary that only repeated the reference — falls back to the caller's
 * template subject and narrates that through `onProgress`. The message is
 * description, and verified work is never lost over a model call. The trailer
 * lines are the same on either path, because the one assembler writes both.
 */
export const composeCommitMessage = async ({ cwd, driver, config, address, runId, onUsage, onProgress }: Params): Promise<string> => {
	const answer = await readAnswer({ cwd, driver, config, address, onUsage });
	let subject = address.fallbackSubject;
	let body: string | undefined;

	if (answer.summary !== undefined) {
		subject = address.reference === '' ? answer.summary : `${address.reference}: ${answer.summary}`;
		body = answer.body;
	} else {
		onProgress?.(`${answer.failure} — committing under '${address.fallbackSubject}' instead`);
	}

	return buildRunCommitMessage({ subject, body, unit: address.unit, runId });
};
