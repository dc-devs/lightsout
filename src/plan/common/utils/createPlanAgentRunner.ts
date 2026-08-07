import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import type { Effort, Permissions } from '@/contracts';
import type { Driver } from '@/drivers';
import { createEventFileSink } from '@/common/utils/createEventFileSink';
import { invokeAgentWithContract } from '@/invoke';

interface Params {
	cwd: string;
	driver: Driver;
	/** The plan's workspace, where this step's evidence lands. */
	workspaceDir: string;
	/** Names the evidence files: `<step>-stream.jsonl` and `<step>-rejected-*.txt`. */
	step: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
}

interface CallParams<Contract extends z.ZodType> {
	invocation: { systemPrompt: string; prompt: string };
	contract: Contract;
	/** Distinguishes rejected payloads when a step invokes the agent once per plan file. */
	label?: string;
	/** Command prefixes this invocation grants the agent (e.g. the self-lint command). */
	allowedCommands?: string[];
}

/**
 * The plan pipeline's agent call, bound to one step's evidence files.
 *
 * Every plan step invokes an agent under a contract and tees the harness stream
 * to `<step>-stream.jsonl` beside a copy of any payload that failed the
 * contract — the same setup three times over, which is three chances to write
 * the tee slightly differently. The transcript sink is created once per step
 * rather than once per call, so a step that invokes the agent per plan file
 * still produces one correctly ordered transcript.
 *
 * Classifying the outcome stays with the caller: a rate limit and a failure
 * mean different things per step, down to the exact re-run command a human is
 * told to type.
 */
export const createPlanAgentRunner = ({ cwd, driver, workspaceDir, step, model, effort, permissions, timeoutMs }: Params) => {
	const onEvent = createEventFileSink({ path: join(workspaceDir, `${step}-stream.jsonl`) });

	return <Contract extends z.ZodType>({ invocation, contract, label, allowedCommands }: CallParams<Contract>) =>
		invokeAgentWithContract({
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
			onRejectedOutput: async ({ text, attempt }) => {
				const name = `${step}-rejected-${label === undefined ? '' : `${label}-`}${attempt}.txt`;

				await writeFile(join(workspaceDir, name), text, 'utf8').catch(() => undefined);
			},
		});
};
