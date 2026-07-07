import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SupervisorDecision, type AgentUsage, type LightsoutConfig } from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { consultSupervisor } from '../common/utils/consultSupervisor';
import { getRunDir } from '../runState';

/** The supervisor consult's terminal condition, mapped by the batch loop. */
type SuperviseOutcome = { kind: 'parked' } | { kind: 'green' } | { kind: 'escalated'; error: string };

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
	invokeGuidedFix: (params: { guidance: string }) => Promise<{ rateLimited?: boolean }>;
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
}: Params): Promise<SuperviseOutcome> => {
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
		onEvent: (event) => {
			void appendFile(join(agentsDir, `stream-${slug}-supervisor.jsonl`), `${JSON.stringify(event)}\n`, 'utf8').catch(() => undefined);
		},
		onRejectedOutput: async ({ text, attempt }) => {
			await writeFile(join(agentsDir, `rejected-${slug}-supervisor-${attempt}.txt`), text, 'utf8').catch(() => undefined);
		},
	});

	await recordUsage({ step: `${batchId}:supervisor`, usage: verdict.usage });

	if (verdict.rateLimited) {
		return { kind: 'parked' };
	}

	if (verdict.report) {
		onProgress(`${batchId}: supervisor verdict — ${verdict.report.decision}`);
	}

	let remainingError: string | undefined = gateError;

	if (verdict.report?.decision === SupervisorDecision.Retry && verdict.report.guidance) {
		const fix = await invokeGuidedFix({
			guidance: `# Supervisor diagnosis\n${verdict.report.diagnosis}\n\n# Supervisor guidance\n${verdict.report.guidance}`,
		});

		if (fix.rateLimited) {
			return { kind: 'parked' };
		}

		remainingError = await gates();
	}

	if (remainingError) {
		const diagnosis = verdict.report ? `\nsupervisor (${verdict.report.decision}): ${verdict.report.diagnosis}` : '';

		return {
			kind: 'escalated',
			error: `${batchId}: gates still red after ${maxCheapFixRetries} fix attempt(s) and a supervisor consult.${diagnosis}\n\n${remainingError}`,
		};
	}

	return { kind: 'green' };
};
