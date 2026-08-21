import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { consultSupervisor } from '#src/common/utils/consultSupervisor.ts';
import { createEventFileSink } from '#src/common/utils/createEventFileSink.ts';
import { type AgentUsage, type LightsoutConfig, SupervisorDecision } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { SettleKind } from '#src/refactor/batch/common/constants/SettleKind.ts';
import type { SettleOutcome } from '#src/refactor/batch/common/types/SettleOutcome.ts';
import { getRunDir } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	batchId: string;
	/** The plan text (standalone banner), for the supervisor's context. */
	planContent: string;
	/** The gate output that survived the cheap fix retries. */
	gateError: string;
	/** Invocations spent on the batch so far, for the supervisor's context. */
	attempts: number;
	/** Cheap-fix retry cap, named in the escalation message. */
	maxCheapFixRetries: number;
	onProgress: (message: string) => void;
	recordUsage: (params: { step: string; usage?: AgentUsage }) => Promise<void>;
	/** One guided fix attempt through the caller's gate-kind routing. */
	invokeGuidedFix: (params: { guidance: string }) => Promise<AgentOutcome<unknown>>;
	/** Re-run the batch's gates after the guided fix. */
	gates: () => Promise<string | undefined>;
}

/**
 * The red-gate exception path for one batch: mechanical retries are
 * exhausted, so a read-only supervisor diagnoses the failure and either
 * grants ONE guided retry or rules it a human problem — escalating with the
 * diagnosis as evidence when even the guided retry stays red.
 */
export const superviseBatch = async ({
	cwd,
	runId,
	driver,
	config,
	batchId,
	planContent,
	gateError,
	attempts,
	maxCheapFixRetries,
	onProgress,
	recordUsage,
	invokeGuidedFix,
	gates,
}: Params): Promise<SettleOutcome> => {
	onProgress(`${batchId}: gates red after ${maxCheapFixRetries} cheap fix attempt(s) — consulting supervisor`);

	const agentsDir = join(getRunDir({ cwd, runId }), 'agents');
	const slug = batchId.replace(/[:/]/g, '_');

	await mkdir(agentsDir, { recursive: true });

	const verdict = await consultSupervisor({
		driver,
		cwd,
		config,
		planContent,
		stepId: batchId,
		errorOutput: gateError,
		attempts,
		onEvent: createEventFileSink({ path: join(agentsDir, `stream-${slug}-supervisor.jsonl`) }),
		onRejectedOutput: async ({ text, attempt }) => {
			await writeFile(join(agentsDir, `rejected-${slug}-supervisor-${attempt}.txt`), text, 'utf8').catch(() => undefined);
		},
	});

	await recordUsage({ step: `${batchId}:supervisor`, usage: verdict.usage });

	if (!verdict.ok && verdict.rateLimited) {
		return { kind: SettleKind.Parked };
	}

	const ruling = verdict.ok ? verdict.report : undefined;

	if (ruling) {
		onProgress(`${batchId}: supervisor verdict — ${ruling.decision}`);
	}

	let remainingError: string | undefined = gateError;

	if (ruling?.decision === SupervisorDecision.Retry && ruling.guidance) {
		const fix = await invokeGuidedFix({
			guidance: `# Supervisor diagnosis\n${ruling.diagnosis}\n\n# Supervisor guidance\n${ruling.guidance}`,
		});

		if (!fix.ok && fix.rateLimited) {
			return { kind: SettleKind.Parked };
		}

		remainingError = await gates();
	}

	if (remainingError) {
		const diagnosis = ruling ? `\nsupervisor (${ruling.decision}): ${ruling.diagnosis}` : '';

		return {
			kind: SettleKind.Escalated,
			error: `${batchId}: gates still red after ${maxCheapFixRetries} fix attempt(s) and a supervisor consult.${diagnosis}\n\n${remainingError}`,
		};
	}

	return { kind: SettleKind.Green };
};
