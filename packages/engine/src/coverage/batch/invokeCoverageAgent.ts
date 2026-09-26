import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createEventFileSink } from '#src/common/utils/createEventFileSink.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { Permissions } from '#src/contracts/Permissions.ts';
import type { AgentUsage } from '#src/contracts/run/AgentUsage.ts';
import { WorkReport } from '#src/contracts/work/WorkReport.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { invokeAgentWithContract } from '#src/invoke/invokeAgentWithContract.ts';
import { appendFriction } from '#src/runState/appendFriction.ts';
import { resolveRunDir } from '#src/runState/common/paths/resolveRunDir.ts';

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	batchId: string;
	invocation: { systemPrompt: string; prompt: string };
	/** Usage-ledger suffix for this invocation ('' | 'fix-N'). */
	label: string;
	/** 1-based invocation number within the batch, for evidence file names. */
	invocationCount: number;
	agentTimeoutMs: number;
	/** Mutable batch-level collectors: agent-reported paths and friction lines accumulate here across invocations. */
	reportedFiles: Set<string>;
	rationale: string[];
	recordUsage: (params: { step: string; usage?: AgentUsage }) => Promise<void>;
}

/**
 * One test-writer invocation within a coverage batch, with the run-evidence
 * plumbing every invocation gets: the event stream teed to the run dir,
 * rejected reports persisted, usage recorded to the ledger, friction appended,
 * and the report's changed files + friction lines folded into the batch's
 * collectors.
 */
export const invokeCoverageAgent = async ({
	cwd,
	runId,
	driver,
	config,
	batchId,
	invocation,
	label,
	invocationCount,
	agentTimeoutMs,
	reportedFiles,
	rationale,
	recordUsage,
}: Params): Promise<Awaited<ReturnType<typeof invokeAgentWithContract<typeof WorkReport>>>> => {
	const agentsDir = join(await resolveRunDir({ cwd, runId }), 'agents');
	const slug = batchId.replace(/[:/]/g, '_');
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

	await recordUsage({ step: `${batchId}${label ? ` ${label}` : ''}`, usage: outcome.usage });

	if (!outcome.ok) {
		return outcome;
	}

	for (const file of outcome.report.changedFiles) {
		reportedFiles.add(file.path);
	}

	if (outcome.report.friction && outcome.report.friction.length > 0) {
		await appendFriction({ cwd, runId, step: batchId, friction: outcome.report.friction });
		rationale.push(...outcome.report.friction.map((entry) => `[${entry.area}] ${entry.detail}`));
	}

	return outcome;
};
