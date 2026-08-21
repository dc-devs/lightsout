import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runFormatter } from '#src/common/processes/runFormatter.ts';
import { createEventFileSink } from '#src/common/utils/createEventFileSink.ts';
import { type AdvisoryOutcome, type AgentUsage, type LightsoutConfig, Permissions, type RefactorBatch, WorkReport } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/index.ts';
import { appendFriction, getRunDir } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	batch: RefactorBatch;
	invocation: { systemPrompt: string; prompt: string };
	/** Usage-ledger suffix for this invocation ('' | 'requeue' | 'fix-N'). */
	label: string;
	/** 1-based invocation number within the batch, for evidence file names. */
	invocationCount: number;
	agentTimeoutMs: number;
	/** Mutable batch-level collectors: agent-reported paths and friction lines accumulate here across invocations. */
	reportedFiles: Set<string>;
	rationale: string[];
	/** Keyed by site key so a later invocation's answer about one advisory replaces the earlier one — the batch's final word, not its first. */
	advisoryOutcomes: Map<string, AdvisoryOutcome>;
	onProgress: (message: string) => void;
	recordUsage: (params: { step: string; usage?: AgentUsage }) => Promise<void>;
}

/**
 * One agent invocation within a batch, with the run-evidence plumbing every
 * invocation gets: the event stream teed to the run dir, rejected reports
 * persisted, usage recorded to the ledger, friction appended, and the
 * report's changed files + friction lines folded into the batch's collectors.
 *
 * The repo's formatter runs over whatever the agent wrote, before anything
 * reads the tree. The executor is forbidden every repository command, and that
 * ban is right for the ones that VERIFY — an agent permitted to run its own
 * tests is an agent that can talk itself into a green one. A formatter verifies
 * nothing. Banning it only means the agent reproduces house formatting by
 * reading its neighbours, and the first run dogfooded on this engine mis-ordered
 * the imports in three of the eight files it wrote: green batch, red repo lint.
 * The command is already in the config, it is deterministic and it changes no
 * behavior, so the engine runs it rather than asking an agent to imitate it.
 *
 * Here rather than in the caller because every write in a batch arrives through
 * this one function — first pass, requeue, polish, every gate fix — and because
 * the gates, the site re-check and the review of what the batch wrote all read
 * the tree afterwards; a re-check reading unformatted code reports line numbers
 * no later pass agrees with.
 */
export const invokeBatchAgent = async ({
	cwd,
	runId,
	driver,
	config,
	batch,
	invocation,
	label,
	invocationCount,
	agentTimeoutMs,
	reportedFiles,
	rationale,
	advisoryOutcomes,
	onProgress,
	recordUsage,
}: Params): Promise<Awaited<ReturnType<typeof invokeAgentWithContract<typeof WorkReport>>>> => {
	const agentsDir = join(getRunDir({ cwd, runId }), 'agents');
	const slug = batch.id.replace(/[:/]/g, '_');
	const streamPath = join(agentsDir, `stream-${slug}-${invocationCount}.jsonl`);

	await mkdir(agentsDir, { recursive: true });

	const outcome = await invokeAgentWithContract({
		driver,
		cwd,
		invocation,
		contract: WorkReport,
		model: config.model,
		effort: config.effort,
		permissions: config.permissions ?? Permissions.Write,
		timeoutMs: agentTimeoutMs,
		allowedCommands: config['agent-commands'],
		onEvent: createEventFileSink({ path: streamPath }),
		onRejectedOutput: async ({ text, attempt }) => {
			await writeFile(join(agentsDir, `rejected-${slug}-${invocationCount}-${attempt}.txt`), text, 'utf8').catch(() => undefined);
		},
	});

	// Before the `ok` check below: an agent that died mid-run still wrote files,
	// and the salvage path reads the same tree every other path does.
	const formatError = await runFormatter({ cwd, runId, config, step: batch.id });

	if (formatError) {
		// Announced and no more. A formatter that cannot run is a human's
		// configuration problem rather than work an agent can fix, and spending
		// the batch's fix retries on it would bury the message under agent output.
		onProgress(`${batch.id}: ${formatError}`);
	}

	await recordUsage({ step: `${batch.id}${label ? ` ${label}` : ''}`, usage: outcome.usage });

	if (!outcome.ok) {
		return outcome;
	}

	for (const file of outcome.report.changedFiles) {
		reportedFiles.add(file.path);
	}

	for (const entry of outcome.report.advisoryOutcomes ?? []) {
		advisoryOutcomes.set(entry.siteKey, entry);
	}

	if (outcome.report.friction && outcome.report.friction.length > 0) {
		await appendFriction({ cwd, runId, step: batch.id, friction: outcome.report.friction });
		rationale.push(...outcome.report.friction.map((entry) => `[${entry.area}] ${entry.detail}`));
	}

	return outcome;
};
