import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPromptImproverInvocation } from '@lightsout/agents';
import { WorkReport } from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { invokeAgentWithContract } from './invoke';
import { readFriction } from './runState';

const improverTimeoutMs = 20 * 60_000;
const promptsDir = 'packages/agents/prompts';

interface Params {
	/** Consumer repo whose accumulated friction feeds the loop. */
	consumerCwd: string;
	/** The lightsout repo (or a clone) whose prompt files may be improved. */
	engineCwd: string;
	driver: Driver;
	model?: string;
}

/**
 * The self-improvement loop: aggregated friction in, prompt edits out. The
 * improver works in the ENGINE repo's worktree — a human reviews the diff and
 * commits; the loop proposes, it does not ship.
 */
export const runPromptImprovement = async ({ consumerCwd, engineCwd, driver, model }: Params) => {
	const friction = await readFriction({ cwd: consumerCwd });

	if (friction.length === 0) {
		return { friction, report: undefined, failure: undefined, rateLimited: false };
	}

	const files = await readdir(join(engineCwd, promptsDir));
	const promptFiles = files.filter((file) => file.endsWith('.md')).map((file) => join(promptsDir, file));

	const { report, failure, rateLimited } = await invokeAgentWithContract({
		driver,
		cwd: engineCwd,
		invocation: buildPromptImproverInvocation({ friction, promptFiles }),
		contract: WorkReport,
		model,
		permissionMode: 'acceptEdits',
		timeoutMs: improverTimeoutMs,
	});

	return { friction, report, failure, rateLimited };
};
