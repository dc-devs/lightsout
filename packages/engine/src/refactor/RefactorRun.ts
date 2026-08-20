import { RunState } from '#src/common/services/RunState.ts';
import type { AgentUsage, LightsoutConfig, RunManifest, RunStatus, StepRecord } from '#src/contracts/index.ts';
import type { RefactorResult } from '#src/refactor/RefactorResult.ts';

interface ConstructorParams {
	cwd: string;
	config: LightsoutConfig;
	/** The run's manifest as loaded/created — the class owns it from here; read via `current()`. */
	manifest: RunManifest;
	/** Declines rebuilt from persisted step reports on resume; the run appends to it. */
	declined: RefactorResult['declined'];
	/** Finding counts per rule at run start, from the frozen worklist. */
	before: Record<string, number>;
	onProgress?: (message: string) => void;
}

/**
 * A refactor run: the state and persistence every run shares, plus the
 * burn-down accounting every exit path of this one reports. The pipeline and
 * its steps mutate run state ONLY through these methods, so the
 * persist-before-the-next-action ordering lives in exactly one place.
 */
export class RefactorRun {
	readonly declined: RefactorResult['declined'];
	readonly before: Record<string, number>;
	// The shared run state is held, not inherited: the burn-down accounting
	// below is this run's own, and the methods it shares with every other run
	// forward to the value it holds.
	private readonly runState: RunState;

	constructor({ cwd, config, manifest, declined, before, onProgress }: ConstructorParams) {
		this.runState = new RunState({ cwd, config, manifest, onProgress });
		this.declined = declined;
		this.before = before;
	}

	get cwd(): string {
		return this.runState.cwd;
	}

	get config(): LightsoutConfig {
		return this.runState.config;
	}

	/** Ceiling for a run's agent invocations, config-resolved once. */
	get agentTimeoutMs(): number {
		return this.runState.agentTimeoutMs;
	}

	/** The live manifest — reread after any update/setStep, never cached by callers. */
	current(): RunManifest {
		return this.runState.current();
	}

	progress(message: string): void {
		this.runState.progress(message);
	}

	update({ patch }: { patch: Partial<RunManifest> }): Promise<void> {
		return this.runState.update({ patch });
	}

	setStep({ record, patch }: { record: StepRecord; patch?: Partial<RunManifest> }): Promise<void> {
		return this.runState.setStep({ record, patch });
	}

	recordUsage({ step, usage }: { step: string; usage?: AgentUsage }): Promise<void> {
		return this.runState.recordUsage({ step, usage });
	}

	/**
	 * The result for a run that ends before the final whole-scope re-check —
	 * with no fresh count, the burn-down's after side can only honestly be its
	 * before side.
	 */
	buildHaltedResult({ error }: { error: string }): RefactorResult {
		return { ok: false, manifest: this.current(), error, declined: this.declined, before: this.before, after: this.before };
	}

	/** Persist a step's terminal status (and the run's), announce it, then halt. */
	async stop({ record, status, error }: { record: StepRecord; status: RunStatus; error: string }): Promise<RefactorResult> {
		await this.setStep({ record: { ...record, status, error }, patch: { status } });
		this.progress(`refactor run stopped at ${record.id} — ${status}`);

		return this.buildHaltedResult({ error });
	}
}
