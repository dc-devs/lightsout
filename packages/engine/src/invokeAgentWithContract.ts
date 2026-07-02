import type { z } from 'zod';
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
}

/**
 * Invoke an agent role and validate its final message against the role's
 * contract. A malformed payload is rejected by the contract and the
 * invocation retried — never hand-parsed around. A rate-limited harness is
 * reported as such so the engine can park the run instead of failing it.
 */
export const invokeAgentWithContract = async <Contract extends z.ZodType>({
	driver,
	cwd,
	invocation,
	contract,
	model,
	permissionMode,
	timeoutMs,
}: Params<Contract>) => {
	let lastFailure = 'no attempts made';

	for (let attempt = 1; attempt <= maxReportAttempts; attempt += 1) {
		const result = await driver.invoke({
			prompt: invocation.prompt,
			systemPrompt: invocation.systemPrompt,
			model,
			permissionMode,
			cwd,
			timeoutMs,
		});

		if (result.rateLimited) {
			return { report: undefined, failure: 'harness rate limit reached', rateLimited: true };
		}

		const parsed = contract.safeParse(extractJsonReport({ text: result.text }));

		if (parsed.success) {
			return { report: parsed.data as z.infer<Contract>, failure: undefined, rateLimited: false };
		}

		lastFailure = `agent output did not match contract (exit ${result.exitCode}): ${parsed.error.message}`;
	}

	return { report: undefined, failure: lastFailure, rateLimited: false };
};
