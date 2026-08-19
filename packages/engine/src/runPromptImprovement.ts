import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPromptImproverInvocation } from '@/agents';
import { type Effort, type FrictionRecord, Permissions, WorkReport } from '@/contracts';
import type { Driver } from '@/drivers';
import { type AgentOutcome, invokeAgentWithContract } from '@/invoke';
import { readFriction } from '@/runState';

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
	| { status: 'no-friction'; friction: FrictionRecord[] }
	| { status: 'invoked'; friction: FrictionRecord[]; outcome: AgentOutcome<WorkReport> };

/**
 * The self-improvement loop: aggregated friction in, prompt edits out. The
 * improver works in the ENGINE repo's worktree — a human reviews the diff and
 * commits; the loop proposes, it does not ship.
 */
export const runPromptImprovement = async ({ consumerCwd, engineCwd, driver, model, effort }: Params): Promise<PromptImprovementResult> => {
	const friction = await readFriction({ cwd: consumerCwd });

	if (friction.length === 0) {
		return { status: 'no-friction', friction };
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

	return { status: 'invoked', friction, outcome };
};
