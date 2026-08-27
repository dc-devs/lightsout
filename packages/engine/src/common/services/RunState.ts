import { defaultAgentTimeoutMinutes } from '#src/common/constants/defaultAgentTimeoutMinutes.ts';
import type { AgentUsage, LightsoutConfig, RunManifest, RunStatus, RunUsage, StepRecord } from '#src/contracts/index.ts';
import { recordAgentUsage, seedUsageTotals, writeManifestWithUsage } from '#src/runState/index.ts';

const upsertStep = ({ steps, record }: { steps: StepRecord[]; record: StepRecord }) => {
	const existing = steps.findIndex((step) => step.id === record.id);

	if (existing === -1) {
		return [...steps, record];
	}

	return steps.map((step, index) => (index === existing ? record : step));
};

interface ConstructorParams {
	cwd: string;
	config: LightsoutConfig;
	/** The run's manifest as loaded/created — the object owns it from here; read via `current()`. */
	manifest: RunManifest;
	onProgress?: (message: string) => void;
}

/**
 * What every kind of run owns: the manifest (rebound on every persisted
 * write), the usage aggregate, and the one route by which either changes.
 * Steps mutate run state ONLY through these methods, so the
 * persist-before-the-next-action ordering lives in exactly one place instead
 * of once per pipeline.
 *
 * A concrete run — the implement pipeline's, the refactor pipeline's — HOLDS
 * one of these and forwards to it, adding the parts that differ: what its
 * steps are, what its halted result looks like, and how it invokes agents.
 */
export class RunState {
	readonly cwd: string;
	readonly config: LightsoutConfig;
	/** Ceiling for a run's agent invocations, config-resolved once. */
	readonly agentTimeoutMs: number;
	private manifest: RunManifest;
	private readonly usageTotals: RunUsage;
	private readonly onProgress?: (message: string) => void;

	constructor({ cwd, config, manifest, onProgress }: ConstructorParams) {
		this.cwd = cwd;
		this.config = config;
		this.manifest = manifest;
		this.onProgress = onProgress;
		this.usageTotals = seedUsageTotals({ usage: manifest.usage });
		this.agentTimeoutMs = (config.timeouts?.['agent-minutes'] ?? defaultAgentTimeoutMinutes) * 60_000;
	}

	/** The live manifest — reread after any update/setStep, never cached by callers. */
	current(): RunManifest {
		return this.manifest;
	}

	progress(message: string): void {
		this.onProgress?.(message);
	}

	async update({ patch }: { patch: Partial<RunManifest> }): Promise<void> {
		this.manifest = await writeManifestWithUsage({ cwd: this.cwd, manifest: this.manifest, patch, usageTotals: this.usageTotals });
	}

	async setStep({ record, patch }: { record: StepRecord; patch?: Partial<RunManifest> }): Promise<void> {
		await this.update({ patch: { ...patch, currentStep: record.id, steps: upsertStep({ steps: this.manifest.steps, record }) } });
	}

	/**
	 * Persist a step's terminal status and the run's, then announce the halt.
	 * The result a halted run reports is the holder's — this is only the
	 * persist-and-announce half, which every kind of run does the same way.
	 *
	 * @param label - what the announcement calls this run, e.g. `coverage run`
	 */
	async stop({ record, status, error, label }: { record: StepRecord; status: RunStatus; error: string; label: string }): Promise<void> {
		await this.setStep({ record: { ...record, status, error }, patch: { status } });
		this.progress(`${label} stopped at ${record.id} — ${status}`);
	}

	recordUsage({ step, usage }: { step: string; usage?: AgentUsage }): Promise<void> {
		return recordAgentUsage({
			cwd: this.cwd,
			runId: this.manifest.runId,
			step,
			model: this.config.model,
			effort: this.config.effort,
			totals: this.usageTotals,
			usage,
		});
	}
}
