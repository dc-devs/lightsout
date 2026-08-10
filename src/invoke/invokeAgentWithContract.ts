import type { z } from 'zod';
import { buildReportReemitterInvocation } from '@/agents';
import { messageOf } from '@/common/utils/messageOf';
import type { AgentUsage, Effort, Permissions } from '@/contracts';
import type { Driver, DriverResult } from '@/drivers';
import type { AgentOutcome } from '@/invoke/common/types/AgentOutcome';
import { extractJsonReport } from '@/invoke/extractJsonReport';

const maxReportAttempts = 2;

/**
 * Usage summed across every attempt — a re-emit retry costs tokens too, and the
 * caller accounts per role invocation, not per process spawn. Stays `undefined`
 * until some attempt reports usage, so a harness that reports nothing is
 * recorded as nothing rather than as zero.
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
	/** Relayed to the driver: one call per harness stream event (transcript tee, progress narration). */
	onEvent?: (event: unknown) => void;
	/** Called with the raw final message whenever it fails the contract — the caller persists it as run evidence. */
	onRejectedOutput?: (params: { text: string; attempt: number; validationError: string }) => Promise<void> | void;
}

/**
 * Invoke an agent role and validate its final message against the role's
 * contract. A malformed payload is rejected by the contract — never
 * hand-parsed around — and retried CHEAPLY: the retry is a re-emit
 * invocation carrying the rejected text ("reconstruct the report from this,
 * touch nothing"), not a re-run of the whole role prompt, so a formatting
 * slip costs seconds instead of minutes. Every rejected message is handed to
 * `onRejectedOutput` before the retry. A rate-limited harness is reported as
 * such so the engine can park the run instead of failing it.
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
	onEvent,
	onRejectedOutput,
}: Params<Contract>): Promise<AgentOutcome<z.infer<Contract>>> => {
	let lastFailure = 'no attempts made';
	let rejected: { rejectedText: string; validationError: string } | undefined;
	let usage: AgentUsage | undefined;

	for (let attempt = 1; attempt <= maxReportAttempts; attempt += 1) {
		const active = rejected ? { systemPrompt: invocation.systemPrompt, prompt: buildReportReemitterInvocation(rejected).prompt } : invocation;

		let result: DriverResult;

		try {
			result = await driver.invoke({
				prompt: active.prompt,
				systemPrompt: active.systemPrompt,
				model,
				effort,
				permissions,
				allowedCommands,
				cwd,
				timeoutMs,
				onEvent,
			});
		} catch (error) {
			// Timeouts and spawn failures are step failures the engine records
			// and the run resumes from — never uncaught crashes that zombie the
			// manifest. No blind retry: a second identical timeout just doubles
			// the cost of learning the ceiling is too low.
			const message = messageOf({ error });

			return { ok: false, failure: `agent invocation failed: ${message}`, rateLimited: false, usage };
		}

		usage = sumUsage({ total: usage, attempt: result.usage });

		if (result.rateLimited) {
			return { ok: false, failure: 'harness rate limit reached', rateLimited: true, usage };
		}

		const parsed = contract.safeParse(extractJsonReport({ text: result.text }));

		if (parsed.success) {
			return { ok: true, report: parsed.data as z.infer<Contract>, usage };
		}

		lastFailure = `agent output did not match contract (exit ${result.exitCode}): ${parsed.error.message}`;
		await onRejectedOutput?.({ text: result.text, attempt, validationError: parsed.error.message });
		rejected = { rejectedText: result.text, validationError: parsed.error.message };
	}

	return { ok: false, failure: lastFailure, rateLimited: false, usage };
};
