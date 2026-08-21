import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFlags } from '#src/cli/index.ts';
import { type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** The id every seeded run answers to, so the assertions can name it. */
export const runId = 'run-resume-01';

/** A stopped implement run, unless the case overrides what it stopped as. */
export const manifestOf = (overrides: Partial<RunManifest> = {}): RunManifest => ({
	runId,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:03.000Z',
	plan: 'ghost.md',
	harness: 'claude-code',
	status: RunStatus.Failed,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
	...overrides,
});

/**
 * A real consumer repo holding the run to resume. Every seeded manifest names a
 * plan file that does not exist, so whichever pipeline the command routes to
 * fails at the plan read — before any harness is spawned — and the routing plus
 * the render-and-exit path stay observable without an agent. `locked` plants a
 * live run lock, the other way a resumed run stops immediately; `ledger` plants
 * the per-invocation agent spend the end-of-run summary tallies.
 */
/** What a seeded run leaves behind under its own folder, for the end-of-run summary to read. */
export interface SeededEvidence {
	/** Per-invocation agent spend for the seeded run, written as its agents.jsonl. */
	ledger?: { step: string; outputTokens: number; costUsd: number }[];
	/** Friction the run's agents reported, written as the repo's friction.jsonl. */
	friction?: { at: string; runId: string; step: string; area: string; detail: string }[];
	/** File names under the run's agents/ folder — a `rejected-` prefix is a report that failed its contract. */
	rejectedReports?: string[];
}

export const setupResume = ({
	args = [],
	manifest,
	evidence = {},
	locked,
	config,
	rawManifest,
}: {
	args?: string[];
	manifest?: RunManifest;
	evidence?: SeededEvidence;
	locked?: boolean;
	config?: Record<string, unknown>;
	/** Manifest text written verbatim under the seeded run id — the way a manifest that does not parse gets onto disk. */
	rawManifest?: string;
} = {}) => {
	const { ledger, friction, rejectedReports } = evidence;
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ config });

	if (rawManifest !== undefined) {
		mkdirSync(join(cwd, '.lightsout', 'runs', runId), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'runs', runId, 'manifest.json'), rawManifest);
	}

	if (manifest) {
		mkdirSync(join(cwd, '.lightsout', 'runs', manifest.runId), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'manifest.json'), JSON.stringify(manifest));
	}

	if (manifest && ledger) {
		writeFileSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'agents.jsonl'), ledger.map((record) => `${JSON.stringify(record)}\n`).join(''));
	}

	if (friction) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'friction.jsonl'), friction.map((record) => `${JSON.stringify(record)}\n`).join(''));
	}

	if (manifest && rejectedReports) {
		mkdirSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'agents'), { recursive: true });

		for (const name of rejectedReports) {
			writeFileSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'agents', name), '{}\n');
		}
	}

	if (locked) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid: process.pid, runId: 'already-running', startedAt: '2026-01-01T00:00:00.000Z' }));
	}

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};
