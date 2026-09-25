import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPromptImproverInvocation } from '#src/agents/buildPromptImproverInvocation.ts';
import { PromptImprovementStatus } from '#src/common/constants/PromptImprovementStatus.ts';
import type { Effort } from '#src/contracts/Effort.ts';
import type { FrictionRecord } from '#src/contracts/friction/FrictionRecord.ts';
import { Permissions } from '#src/contracts/Permissions.ts';
import { WorkReport } from '#src/contracts/work/WorkReport.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { AgentOutcome } from '#src/invoke/common/types/AgentOutcome.ts';
import { invokeAgentWithContract } from '#src/invoke/invokeAgentWithContract.ts';
import { readFriction } from '#src/runState/readFriction.ts';

const promptsDir = 'src/agents/prompts';

interface Params {
	/** Consumer repo whose accumulated friction feeds the loop. */
	consumerCwd: string;
	/** The lightsout repo (or a clone) whose prompt files may be improved. */
	engineCwd: string;
	driver: Driver;
	model?: string;
	/** Resolved per-command reasoning effort. */
	effort?: Effort;
}

type PromptImprovementResult =
	| { status: typeof PromptImprovementStatus.NoFriction; friction: FrictionRecord[] }
	| { status: typeof PromptImprovementStatus.Invoked; friction: FrictionRecord[]; outcome: AgentOutcome<WorkReport> };

/**
 * The self-improvement loop: aggregated friction in, prompt edits out. The
 * improver works in the ENGINE repo's worktree — a human reviews the diff and
 * commits; the loop proposes, it does not ship.
 */
export const runPromptImprovement = async ({ consumerCwd, engineCwd, driver, model, effort }: Params): Promise<PromptImprovementResult> => {
	const friction = await readFriction({ cwd: consumerCwd });

	if (friction.length === 0) {
		return { status: PromptImprovementStatus.NoFriction, friction };
	}

	const files = await readdir(join(engineCwd, promptsDir));
	const promptFiles = files.filter((file) => file.endsWith('.md')).map((file) => join(promptsDir, file));

	const improverTimeoutMs = 20 * 60_000;
	const outcome = await invokeAgentWithContract({
		driver,
		cwd: engineCwd,
		invocation: buildPromptImproverInvocation({ friction, promptFiles }),
		contract: WorkReport,
		model,
		effort,
		permissions: Permissions.Write,
		timeoutMs: improverTimeoutMs,
	});

	return { status: PromptImprovementStatus.Invoked, friction, outcome };
};
