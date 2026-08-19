import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RunState } from '@/common/services/RunState';
import { createEventFileSink } from '@/common/utils/createEventFileSink';
import { type AgentUsage, type LightsoutConfig, Permissions, type RunManifest, RunStatus, type StepRecord, WorkReport } from '@/contracts';
import type { Driver } from '@/drivers';
import { invokeAgentWithContract } from '@/invoke';
import type { PipelineResult } from '@/pipeline/PipelineResult';
import { getRunDir } from '@/runState';

const formatTokens = (count: number) => (count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`);

const formatUsage = (usage: AgentUsage) =>
	`in ${formatTokens(usage.inputTokens)} · out ${formatTokens(usage.outputTokens)} · cache-read ${formatTokens(usage.cacheReadTokens)} · $${usage.costUsd.toFixed(2)}`;

interface ConstructorParams {
	cwd: string;
	config: LightsoutConfig;
	driver: Driver;
	/** The run's manifest as loaded/created — the class owns it from here; read via `current()`. */
	manifest: RunManifest;
	onProgress?: (message: string) => void;
}

/**
 * The implement run's moving parts as one owned object: the state and
 * persistence every run shares, plus step timers, the evidence counters, and
 * the invocation plumbing every agent call goes through. Steps mutate run
 * state ONLY through these methods, so the persist-before-next-action
 * ordering lives in exactly one place. Deliberately small: state +
 * persistence + invocation; derivations that merely read the run live in
 * their own files.
 */
export class PipelineRun {
	/** Public: the supervisor consult invokes with its own contract/timeouts, outside invokeRole. */
	readonly driver: Driver;
	// The shared run state is held, not inherited: what this run adds — step
	// timers, evidence counters, agent invocation — stays visible against a
	// plain value it forwards to.
	private readonly runState: RunState;
	// Active time per step, accumulated across attempts and resumes: the
	// timer starts when nextRecord picks the step up (seeded with any prior
	// durationMs), and every manifest write re-stamps the running total — so
	// even a crashed run keeps the duration up to its last persisted moment.
	private readonly stepTimers = new Map<string, { startedAt: number; baseMs: number }>();
	private transcriptCount = 0;
	private rejectedCount = 0;

	constructor({ cwd, config, driver, manifest, onProgress }: ConstructorParams) {
		this.runState = new RunState({ cwd, config, manifest, onProgress });
		this.driver = driver;
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

	update(patch: Partial<RunManifest>): Promise<void> {
		return this.runState.update(patch);
	}

	parkMessage(): string {
		return `run parked: harness rate limited or overloaded — resume with \`lightsout resume --run ${this.current().runId}\` when the window resets.`;
	}

	async setStep({ record, patch }: { record: StepRecord; patch?: Partial<RunManifest> }): Promise<void> {
		const timer = this.stepTimers.get(record.id);
		const timed = timer ? { ...record, durationMs: timer.baseMs + (Date.now() - timer.startedAt) } : record;

		await this.runState.setStep({ record: timed, patch });
	}

	nextRecord({ id }: { id: string }): StepRecord {
		const prev = this.current().steps.find((step) => step.id === id);

		this.stepTimers.set(id, { startedAt: Date.now(), baseMs: prev?.durationMs ?? 0 });

		return { id, status: RunStatus.Running, attempts: (prev?.attempts ?? 0) + 1, changedFiles: prev?.changedFiles };
	}

	async stop({ record, status, error }: { record: StepRecord; status: RunStatus; error: string }): Promise<PipelineResult> {
		await this.setStep({ record: { ...record, status, error }, patch: { status } });
		this.progress(`run stopped at ${record.id} — ${status}`);

		return { ok: false, manifest: this.current(), error };
	}

	async recordUsage({ step, usage }: { step: string; usage?: AgentUsage }): Promise<void> {
		await this.runState.recordUsage({ step, usage });

		if (usage) {
			this.progress(`  ${step} · usage: ${formatUsage(usage)}`);
		}
	}

	// Every agent invocation's full event stream (tool calls, chat text, the
	// final result) is teed to agents/stream-NN-<step>.jsonl — the chat as
	// on-disk run evidence, tail-able live for anyone who wants the
	// play-by-play. The progress stream stays quiet per event: a working
	// agent fires tools every few seconds, and narrating each one drowned
	// the terminal. Evidence only: outcomes never depend on it.
	agentEventSink({ step }: { step: string }): (event: unknown) => void {
		this.transcriptCount += 1;

		const dir = join(getRunDir({ cwd: this.cwd, runId: this.current().runId }), 'agents');
		const path = join(dir, `stream-${String(this.transcriptCount).padStart(2, '0')}-${step}.jsonl`);

		return createEventFileSink({ path, ready: mkdir(dir, { recursive: true }) });
	}

	// A final message that fails its contract is still evidence — persist it
	// to the run dir before any retry, so a rejected report never has to be
	// recovered from harness-internal session files again.
	persistRejected({ step }: { step: string }): (params: { text: string; attempt: number; validationError: string }) => Promise<void> {
		return async ({ text, attempt, validationError }) => {
			this.rejectedCount += 1;

			const dir = join(getRunDir({ cwd: this.cwd, runId: this.current().runId }), 'agents');
			const name = `rejected-${String(this.rejectedCount).padStart(2, '0')}-${step}-attempt${attempt}.txt`;

			await mkdir(dir, { recursive: true });
			await writeFile(join(dir, name), `# step: ${step} · invocation attempt ${attempt}\n# validation: ${validationError}\n\n${text}`, 'utf8');
			this.progress(`step ${step}: agent final message failed the report contract — raw text saved to .lightsout/runs/${this.current().runId}/agents/${name}`);
		};
	}

	// onFirstEvent fires once, on the invocation's first streamed event — the
	// moment the harness's response began, and so the moment a prompt-cache
	// entry for this system prompt becomes readable by a concurrent spawn.
	// Drivers with no event stream never fire it; callers must not depend on it
	// for outcomes.
	async invokeRole({
		invocation,
		step,
		onFirstEvent,
	}: {
		invocation: { systemPrompt: string; prompt: string };
		step: string;
		onFirstEvent?: () => void;
	}): Promise<Awaited<ReturnType<typeof invokeAgentWithContract<typeof WorkReport>>>> {
		const sink = this.agentEventSink({ step });
		let seenFirst = false;

		const outcome = await invokeAgentWithContract({
			driver: this.driver,
			cwd: this.cwd,
			invocation,
			contract: WorkReport,
			model: this.config.model,
			effort: this.config.effort,
			permissions: this.config.permissions ?? Permissions.Write,
			timeoutMs: this.agentTimeoutMs,
			// Harness-level allowance for all working roles; the binding grant
			// is the prompt section, which only the executor's builder emits.
			allowedCommands: this.config['agent-commands'],
			onEvent: (event) => {
				if (!seenFirst) {
					seenFirst = true;
					onFirstEvent?.();
				}

				sink(event);
			},
			onRejectedOutput: this.persistRejected({ step }),
		});

		await this.recordUsage({ step, usage: outcome.usage });

		return outcome;
	}
}
