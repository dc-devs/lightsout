import { RunState } from '#src/common/services/RunState.ts';
import type { AgentUsage, CoverageTotal, LightsoutConfig, RunManifest, RunStatus, StepRecord } from '#src/contracts/index.ts';
import type { CoverageResult } from '#src/coverage/CoverageResult.ts';
import type { CoverageSetAside } from '#src/coverage/common/types/CoverageSetAside.ts';

interface ConstructorParams {
	cwd: string;
	config: LightsoutConfig;
	/** The run's manifest as loaded/created — the class owns it from here; read via `current()`. */
	manifest: RunManifest;
	/** Files routed to a human, rebuilt from persisted batch reports on resume; the run appends to it. */
	setAside: CoverageSetAside[];
	/** Per-scope statements pct at run start, from the frozen worklist. */
	before: CoverageTotal[];
	onProgress?: (message: string) => void;
}

/**
 * A coverage run: the state and persistence every run shares, plus the
 * set-aside list and the before/after measurements every exit path of this one
 * reports. The pipeline and its steps mutate run state ONLY through these
 * methods, so the persist-before-the-next-action ordering lives in exactly one
 * place.
 */
export class CoverageRun {
	readonly setAside: CoverageSetAside[];
	readonly before: CoverageTotal[];
	// The shared run state is held, not inherited: the coverage accounting above
	// is this run's own, and the methods it shares with every other run forward
	// to the value it holds.
	private readonly runState: RunState;

	constructor({ cwd, config, manifest, setAside, before, onProgress }: ConstructorParams) {
		this.runState = new RunState({ cwd, config, manifest, onProgress });
		this.setAside = setAside;
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
	 * The result for a run that ends before a green measurement — with no fresh
	 * numbers, the after side can only honestly be the before side.
	 */
	buildHaltedResult({ error }: { error: string }): CoverageResult {
		return { ok: false, manifest: this.current(), error, setAside: this.setAside, before: this.before, after: this.before };
	}

	/** Persist a step's terminal status (and the run's), announce it, then halt. */
	async stop({ record, status, error }: { record: StepRecord; status: RunStatus; error: string }): Promise<CoverageResult> {
		await this.setStep({ record: { ...record, status, error }, patch: { status } });
		this.progress(`coverage run stopped at ${record.id} — ${status}`);

		return this.buildHaltedResult({ error });
	}
}
