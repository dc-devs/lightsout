import type { z } from 'zod';
import { buildReportReemitterInvocation } from '#src/agents/index.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { AgentUsage, Effort, Permissions } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation, DriverResult } from '#src/drivers/index.ts';
import type { AgentOutcome } from '#src/invoke/common/types/AgentOutcome.ts';
import { extractJsonReport } from '#src/invoke/extractJsonReport.ts';

/**
 * Usage summed across every rung of the ladder — a re-emit retry and a re-run
 * both cost tokens, and the caller accounts per call, not per process spawn.
 * Stays `undefined` until some rung reports usage, so a harness that reports
 * nothing is recorded as nothing rather than as zero.
 */
const sumUsage = ({ total, attempt }: { total?: AgentUsage; attempt?: AgentUsage }) => {
	if (!attempt) {
		return total;
	}

	const base = total ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 };

	return {
		inputTokens: base.inputTokens + attempt.inputTokens,
		outputTokens: base.outputTokens + attempt.outputTokens,
		cacheReadTokens: base.cacheReadTokens + attempt.cacheReadTokens,
		cacheCreationTokens: base.cacheCreationTokens + attempt.cacheCreationTokens,
		costUsd: base.costUsd + attempt.costUsd,
	};
};

/**
 * Whether the cheap re-emit is worth spending on this rejection.
 *
 * Handing an agent an empty or one-line error message and asking it to restate
 * it as a report cannot succeed — one graded pass spent seven such turns and got
 * the identical text back every time — so a rejection holding no object to
 * reconstruct from does not earn one.
 *
 * The ceiling-of-1 carve-out is backward compatibility, not reasoning about what
 * could work: a caller that never opted into a re-run keeps the default ladder
 * exactly, spending its re-emit even on a rejection this predicate judges
 * hopeless.
 */
const shouldReemit = ({ payload, maxRoleAttempts }: { payload: unknown; maxRoleAttempts: number }) =>
	maxRoleAttempts === 1 || (typeof payload === 'object' && payload !== null);

/**
 * One rung of the ladder: spawn the harness and say what it produced, without
 * deciding what happens next. Kept apart from the loop that decides, so that
 * loop has room for the reasoning behind each of its exits — a chokepoint whose
 * reasoning has been squeezed out to fit a line cap is the wrong thing to leave
 * behind.
 */
const spawnRung = async ({
	driver,
	invocation,
}: {
	driver: Driver;
	invocation: DriverInvocation;
}): Promise<{ ok: true; result: DriverResult } | { ok: false; failure: string }> => {
	try {
		return { ok: true, result: await driver.invoke(invocation) };
	} catch (error) {
		// Timeouts and spawn failures are step failures the engine records
		// and the run resumes from — never uncaught crashes that zombie the
		// manifest. No blind retry: a second identical timeout just doubles
		// the cost of learning the ceiling is too low.
		return { ok: false, failure: `agent invocation failed: ${messageOf({ error })}` };
	}
};

interface Params<Contract extends z.ZodType> {
	driver: Driver;
	cwd: string;
	invocation: { systemPrompt: string; prompt: string };
	contract: Contract;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
	/** Consumer-granted command prefixes, relayed to the driver's allowed-tools mechanism. */
	allowedCommands?: string[];
	/**
	 * Fresh role invocations this call may spend before giving up on the
	 * contract — the re-run ceiling. Defaults to 1: one role invocation plus its
	 * one cheap re-emit, which is every caller's behaviour today. Only the plan
	 * grade readers raise it, because a reader written off costs a whole graded
	 * pass while every other role's failure costs one step.
	 */
	maxRoleAttempts?: number;
	/** Relayed to the driver: one call per harness stream event (transcript tee, progress narration). */
	onEvent?: (event: unknown) => void;
	/** Called with the raw final message whenever it fails the contract — the caller persists it as run evidence. */
	onRejectedOutput?: (params: { text: string; attempt: number; validationError: string }) => Promise<void> | void;
}

/**
 * Invoke an agent role and validate its final message against the role's
 * contract. A malformed payload is rejected by the contract — never
 * hand-parsed around — and retried CHEAPLY first: the retry is a re-emit
 * invocation carrying the rejected text ("reconstruct the report from this,
 * touch nothing"), not a re-run of the whole role prompt, so a formatting
 * slip costs seconds instead of minutes. A caller that opted into a ceiling
 * above one may then re-run the role from scratch, each fresh invocation
 * carrying its own re-emit; a rejection with no object in it skips the
 * re-emit, because restating a one-line error message as a report cannot
 * work — unless the caller took the default ceiling, whose ladder is
 * unchanged. Every rejected message is handed to `onRejectedOutput` before the
 * next rung, under a spawn number that never restarts, so no rung overwrites
 * an earlier rung's evidence. A rate-limited harness is reported as such,
 * from whatever rung met the wall, so the engine can park the run instead of
 * failing it.
 */
export const invokeAgentWithContract = async <Contract extends z.ZodType>({
	driver,
	cwd,
	invocation,
	contract,
	model,
	effort,
	permissions,
	timeoutMs,
	allowedCommands,
	maxRoleAttempts = 1,
	onEvent,
	onRejectedOutput,
}: Params<Contract>): Promise<AgentOutcome<z.infer<Contract>>> => {
	// What ended the ladder, minus the bill: `usage` is threaded on once, at the
	// single exit, so no rung can return an outcome that under-reports what the
	// call burned. Its starting value is what a ceiling below one returns — a
	// ladder with no rungs says so rather than throwing at a value no caller
	// passes — and every contract rejection overwrites it, so a ladder that runs
	// out ends carrying the last rung's reason.
	let settled: { ok: true; report: z.infer<Contract> } | { ok: false; failure: string; rateLimited: boolean } = {
		ok: false,
		failure: 'no attempts made',
		rateLimited: false,
	};
	let rejected: { rejectedText: string; validationError: string } | undefined;
	let usage: AgentUsage | undefined;
	let attempt = 0;
	let roleAttempts = 0;

	// The second clause is what lets the last role invocation still spend its
	// re-emit after the ceiling is used up.
	while (roleAttempts < maxRoleAttempts || rejected !== undefined) {
		const isReemit = rejected !== undefined;
		const active = rejected ? { systemPrompt: invocation.systemPrompt, prompt: buildReportReemitterInvocation(rejected).prompt } : invocation;

		if (!isReemit) {
			roleAttempts += 1;
		}

		attempt += 1;

		const rung = await spawnRung({ driver, invocation: { ...active, cwd, model, effort, permissions, timeoutMs, allowedCommands, onEvent } });

		if (!rung.ok) {
			settled = { ok: false, failure: rung.failure, rateLimited: false };

			break;
		}

		usage = sumUsage({ total: usage, attempt: rung.result.usage });

		if (rung.result.rateLimited) {
			settled = { ok: false, failure: 'harness rate limited or overloaded', rateLimited: true };

			break;
		}

		const payload = extractJsonReport({ text: rung.result.text });
		const parsed = contract.safeParse(payload);

		if (parsed.success) {
			settled = { ok: true, report: parsed.data };

			break;
		}

		settled = { ok: false, failure: `agent output did not match contract (exit ${rung.result.exitCode}): ${parsed.error.message}`, rateLimited: false };
		await onRejectedOutput?.({ text: rung.result.text, attempt, validationError: parsed.error.message });
		// A re-emit that also failed has spent this role invocation's one cheap
		// recovery — the next rung is a fresh role prompt, or the end of the ladder.
		rejected = isReemit || !shouldReemit({ payload, maxRoleAttempts }) ? undefined : { rejectedText: rung.result.text, validationError: parsed.error.message };
	}

	return { ...settled, usage };
};
