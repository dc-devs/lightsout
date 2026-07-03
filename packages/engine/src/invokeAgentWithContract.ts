import type { z } from 'zod';
import { buildReportReemitterInvocation } from '@lightsout/agents';
import type { Driver } from '@lightsout/drivers';
import { extractJsonReport } from './extractJsonReport';

const maxReportAttempts = 2;

interface Params<Contract extends z.ZodType> {
	driver: Driver;
	cwd: string;
	invocation: { systemPrompt: string; prompt: string };
	contract: Contract;
	model?: string;
	permissionMode?: string;
	timeoutMs?: number;
	/** Consumer-granted command prefixes, relayed to the driver's allowed-tools mechanism. */
	allowedCommands?: string[];
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
	permissionMode,
	timeoutMs,
	allowedCommands,
	onRejectedOutput,
}: Params<Contract>) => {
	let lastFailure = 'no attempts made';
	let rejected: { rejectedText: string; validationError: string } | undefined;

	for (let attempt = 1; attempt <= maxReportAttempts; attempt += 1) {
		const active = rejected
			? { systemPrompt: invocation.systemPrompt, prompt: buildReportReemitterInvocation(rejected).prompt }
			: invocation;

		let result;

		try {
			result = await driver.invoke({
				prompt: active.prompt,
				systemPrompt: active.systemPrompt,
				model,
				permissionMode,
				allowedCommands,
				cwd,
				timeoutMs,
			});
		} catch (error) {
			// Timeouts and spawn failures are step failures the engine records
			// and the run resumes from — never uncaught crashes that zombie the
			// manifest. No blind retry: a second identical timeout just doubles
			// the cost of learning the ceiling is too low.
			const message = error instanceof Error ? error.message : String(error);

			return { report: undefined, failure: `agent invocation failed: ${message}`, rateLimited: false };
		}

		if (result.rateLimited) {
			return { report: undefined, failure: 'harness rate limit reached', rateLimited: true };
		}

		const parsed = contract.safeParse(extractJsonReport({ text: result.text }));

		if (parsed.success) {
			return { report: parsed.data as z.infer<Contract>, failure: undefined, rateLimited: false };
		}

		lastFailure = `agent output did not match contract (exit ${result.exitCode}): ${parsed.error.message}`;
		await onRejectedOutput?.({ text: result.text, attempt, validationError: parsed.error.message });
		rejected = { rejectedText: result.text, validationError: parsed.error.message };
	}

	return { report: undefined, failure: lastFailure, rateLimited: false };
};
