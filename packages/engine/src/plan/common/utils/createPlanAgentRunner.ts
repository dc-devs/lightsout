import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import type { ActivityLevel } from '#src/activity/index.ts';
import { createEventFileSink } from '#src/common/utils/createEventFileSink.ts';
import { ActivityLevelKind, type Effort, type Permissions } from '#src/contracts/index.ts';
import type { AgentEnvironment, Driver } from '#src/drivers/index.ts';
import { type AgentOutcome, getAgentOutcomeStatus, invokeAgentWithContract } from '#src/invoke/index.ts';

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
	/** Fresh role invocations each of this step's calls may spend. Defaults to the chokepoint's own default of one. */
	maxRoleAttempts?: number;
	/** A focused role's requested agent environment, relayed on every call this runner makes. A runner created without one produces exactly today's invocation. */
	environment?: AgentEnvironment;
	/** The level each of this runner's calls opens its own step level under. Absent wherever no run is being recorded, which leaves every call exactly as it was. */
	level?: ActivityLevel;
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
 * still produces one correctly ordered transcript. The rejected-payload name
 * carries the chokepoint's spawn number, which keeps rising across a step's
 * fresh role attempts as well as its re-emits — load-bearing for a step that
 * raised `maxRoleAttempts`, whose evidence would otherwise overwrite itself.
 *
 * Classifying the outcome stays with the caller: a rate limit and a failure
 * mean different things per step, down to the exact re-run command a human is
 * told to type.
 *
 * The step LEVEL, unlike that sink, is opened per call: a level has to end when
 * its call ends, and a runner has no disposal hook to end one on. Two calls
 * from one runner therefore produce two sibling rows under the same label,
 * which is the truth — they were two requests. A runner created without a level
 * opens nothing, hands the chokepoint nothing, and writes no mark.
 */
export const createPlanAgentRunner = ({
	cwd,
	driver,
	workspaceDir,
	step,
	model,
	effort,
	permissions,
	timeoutMs,
	maxRoleAttempts,
	environment,
	level,
}: Params): (<Contract extends z.ZodType>(params: CallParams<Contract>) => Promise<AgentOutcome<z.infer<Contract>>>) => {
	const onEvent = createEventFileSink({ path: join(workspaceDir, `${step}-stream.jsonl`) });

	return async <Contract extends z.ZodType>({ invocation, contract, label, allowedCommands }: CallParams<Contract>) => {
		const stepLevel = level?.open({ level: ActivityLevelKind.Step, label: label === undefined ? step : `${step}-${label}` });
		const outcome = await invokeAgentWithContract({
			driver,
			cwd,
			invocation,
			contract,
			model,
			effort,
			permissions,
			timeoutMs,
			maxRoleAttempts,
			allowedCommands,
			environment,
			onEvent,
			onRejectedOutput: async ({ text, attempt }) => {
				const name = `${step}-rejected-${label === undefined ? '' : `${label}-`}${attempt}.txt`;

				await writeFile(join(workspaceDir, name), text, 'utf8').catch(() => undefined);
			},
			activity: stepLevel,
		});

		stepLevel?.close({ outcome: getAgentOutcomeStatus({ outcome }) });

		return outcome;
	};
};
