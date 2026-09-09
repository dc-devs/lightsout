import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { consultSupervisor } from '#src/common/utils/consultSupervisor.ts';
import { createEventFileSink } from '#src/common/utils/createEventFileSink.ts';
import { type AgentUsage, type LightsoutConfig, SupervisorDecision } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
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
	/** Re-run the batch's gates after the guided fix, answering their whole verdict. */
	gates: () => Promise<GateRunResult>;
}

/**
 * The read-only supervisor's ruling on the red that survived the cheap retries,
 * with its event stream and any rejected output written beside the run so a
 * human can read what it was shown.
 */
const consultBatchSupervisor = async ({
	cwd,
	runId,
	driver,
	config,
	planContent,
	batchId,
	gateError,
	attempts,
}: {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	planContent: string;
	batchId: string;
	gateError: string;
	attempts: number;
}) => {
	const agentsDir = join(getRunDir({ cwd, runId }), 'agents');
	const slug = batchId.replace(/[:/]/g, '_');

	await mkdir(agentsDir, { recursive: true });

	return consultSupervisor({
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
};

/**
 * The red-gate exception path for one batch: mechanical retries are
 * exhausted, so a read-only supervisor diagnoses the failure and either
 * grants ONE guided retry or rules it a human problem — escalating with the
 * diagnosis as evidence when even the guided retry stays red.
 *
 * `gateError` stays a plain string: it is the red that survived the cheap
 * retries, and reaching here at all means that red was evidence. The re-run
 * after the guided fix answers a whole verdict, because it can come back having
 * never got the machine — and that escalates naming coordination rather than
 * reporting gates still red, which no command would have established.
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

	const verdict = await consultBatchSupervisor({ cwd, runId, driver, config, planContent, batchId, gateError, attempts });

	await recordUsage({ step: `${batchId}:supervisor`, usage: verdict.usage });

	const ruling = verdict.ok ? verdict.report : undefined;

	if (ruling) {
		onProgress(`${batchId}: supervisor verdict — ${ruling.decision}`);
	}

	let outcome: SettleOutcome | undefined;
	let remainingError: string | undefined = gateError;
	let coordination: string | undefined;

	if (!verdict.ok && verdict.rateLimited) {
		outcome = { kind: SettleKind.Parked };
	} else if (ruling?.decision === SupervisorDecision.Retry && ruling.guidance) {
		const fix = await invokeGuidedFix({
			guidance: `# Supervisor diagnosis\n${ruling.diagnosis}\n\n# Supervisor guidance\n${ruling.guidance}`,
		});

		if (!fix.ok && fix.rateLimited) {
			outcome = { kind: SettleKind.Parked };
		} else {
			const rerun = await gates();

			remainingError = rerun.error;
			coordination = rerun.coordination;
		}
	}

	// Undefined here means nothing was rate limited, so the gates' own answer decides.
	if (outcome === undefined) {
		if (coordination !== undefined) {
			outcome = { kind: SettleKind.Escalated, error: coordination };
		} else if (remainingError) {
			const diagnosis = ruling ? `\nsupervisor (${ruling.decision}): ${ruling.diagnosis}` : '';

			outcome = {
				kind: SettleKind.Escalated,
				error: `${batchId}: gates still red after ${maxCheapFixRetries} fix attempt(s) and a supervisor consult.${diagnosis}\n\n${remainingError}`,
			};
		} else {
			outcome = { kind: SettleKind.Green };
		}
	}

	return outcome;
};
