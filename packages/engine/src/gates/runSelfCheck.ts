import { resolveGateOverride } from '#src/common/config/resolveGateOverride.ts';
import { resolveGates } from '#src/common/config/resolveGates.ts';
import { resolvePackageGatesConfig } from '#src/common/config/resolvePackageGatesConfig.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { buildSelfCheckStep } from '#src/common/selfCheck/buildSelfCheckStep.ts';
import { packageOf } from '#src/common/workspace/packageOf.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
import { SelfCheckReason } from '#src/gates/common/constants/SelfCheckReason.ts';
import type { GateCommands } from '#src/gates/common/types/GateCommands.ts';
import type { GateSchedule } from '#src/gates/common/types/GateSchedule.ts';
import type { SelfCheckResult } from '#src/gates/common/types/SelfCheckResult.ts';
import { buildGateEntries } from '#src/gates/common/utils/buildGateEntries.ts';
import { collectGateObservations } from '#src/gates/common/utils/collectGateObservations.ts';
import { resolveGateSchedule } from '#src/gates/common/utils/resolveGateSchedule.ts';
import { rootGateCommands } from '#src/gates/common/utils/rootGateCommands.ts';
import { selfCheckGateNames } from '#src/gates/common/utils/selfCheckGateNames.ts';
import { runGates } from '#src/gates/runGates.ts';

/**
 * The root and scoped groups' commands as one set, duplicate names dropped and
 * the engine's canonical order kept.
 *
 * Names read off the root block alone would never schedule a build that only
 * `package-gates` declares. Naming a gate a group has no entry for costs
 * nothing, because selection runs over each group's own entries.
 */
const unionCommands = ({ root, scoped }: { root: GateCommands; scoped: GateCommands | undefined }): GateCommands => {
	if (scoped === undefined) {
		return root;
	}

	const extraTests = [...(root.extraTests ?? [])];

	for (const extra of scoped.extraTests ?? []) {
		if (!extraTests.some((entry) => entry.name === extra.name)) {
			extraTests.push(extra);
		}
	}

	return {
		check: root.check ?? scoped.check,
		test: root.test ?? scoped.test,
		testCoverage: root.testCoverage ?? scoped.testCoverage,
		extraTests,
		build: root.build ?? scoped.build,
	};
};

/**
 * What this self-check runs against: the packages the live diff touched, or the
 * whole tree where the pipeline it belongs to reads no diff either.
 *
 * The two empty answers `git status` can give are answered separately rather
 * than folded into one list the way a batch run folds them. A batch may widen to
 * the whole repository because its caller pays that once after a committed
 * batch; a self-check that widened would run the whole repository's unit suite
 * inside the agent's own timeout, which is the cost a scoped self-check exists
 * to avoid.
 */
const resolveScope = async ({
	cwd,
	config,
	wholeRepository,
}: {
	cwd: string;
	config: LightsoutConfig;
	wholeRepository: boolean;
}): Promise<{ scope: { packages?: string[]; includeRoot?: boolean } } | { reason: SelfCheckReason }> => {
	if (wholeRepository) {
		return { scope: {} };
	}

	const changed = await readGitChangedFiles({ cwd });

	if (changed === undefined) {
		return { reason: SelfCheckReason.Unavailable };
	}

	if (changed.length === 0) {
		return { reason: SelfCheckReason.NothingChanged };
	}

	const packagesDir = config['packages-dir'] ?? defaultPackagesDir;
	const touched = changed.flatMap((file) => {
		const name = packageOf({ file, packagesDir });

		return name === undefined ? [] : [name];
	});

	return {
		scope: { packages: [...new Set(touched)], includeRoot: changed.some((file) => packageOf({ file, packagesDir }) === undefined) },
	};
};

/**
 * The gate names this self-check schedules: the cheap-tier entries of the
 * schedule the following checkpoint would run, plus the build.
 *
 * The names are derived from the root and scoped groups together, because
 * `package-gates` may declare a build the root block does not.
 */
const scheduledGateNames = ({ config, coverage, checkpoint }: { config: LightsoutConfig; coverage: boolean; checkpoint: string | undefined }) => {
	const schedule: GateSchedule =
		checkpoint === undefined
			? { kind: GateScheduleKind.Single }
			: resolveGateSchedule({ override: resolveGateOverride({ overrides: config['gate-overrides'], checkpoint }) });
	const scopedBlock = config['package-gates'];
	const entries = buildGateEntries({
		commands: unionCommands({
			root: rootGateCommands({ gates: resolveGates({ gates: config.gates }) }),
			scoped: scopedBlock === undefined ? undefined : resolvePackageGatesConfig({ packageGates: scopedBlock }),
		}),
	});

	return selfCheckGateNames({ entries, schedule, coverage });
};

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Whether the coverage gate can give a true answer at this step. Off at implement, on at refactor and in the direct pipeline. */
	coverage: boolean;
	/** The checkpoint whose `gate-overrides` entry decides the schedule this mirrors. Absent in the direct pipeline, which has no checkpoint names and runs a single stage. */
	checkpoint?: string;
	/** Run the root gate set over the whole tree instead of the packages the live diff touched — what the direct pipeline's own gate pass does. */
	wholeRepository: boolean;
	runId: string;
	/** The pipeline step the agent is inside; the recorded step name is derived from it. */
	step: string;
	onProgress: (message: string) => void;
}

/**
 * A writing agent's own check of its change, run inside its own spawn: the
 * cheap-tier gates the following checkpoint would run, plus the build, narrowed
 * to the packages the live git diff touched.
 *
 * It is the one gate caller in the engine that does not wait for the machine: a
 * busy machine ends it on the coordination reason at once, carrying no gate
 * verdict at all, because an advisory check has nothing to gain from half an
 * hour of a paid agent session.
 *
 * It records no verdict anywhere. Its executions land in the run's command log
 * under a step name of their own, so the checkpoint that follows reads its own
 * evidence and the run's accounting can subtract this work; the engine's gates
 * stay the only authority on whether a step passed.
 */
export const runSelfCheck = async ({ cwd, config, coverage, checkpoint, wholeRepository, runId, step, onProgress }: Params): Promise<SelfCheckResult> => {
	const gateNames = scheduledGateNames({ config, coverage, checkpoint });
	// The shape every ending that runs no gate shares — held once rather than
	// written out per branch, which is where one branch eventually forgets a
	// field.
	let result: SelfCheckResult = { reason: SelfCheckReason.NothingScheduled, gateNames, gates: [], error: undefined, crashes: [], coordination: undefined };

	// The empty name list is answered before any gate call at all, because an
	// exact schedule with an empty list still runs the configured codegen command
	// — and a checkpoint that is off is not a green one.
	if (gateNames.length > 0) {
		const resolved = await resolveScope({ cwd, config, wholeRepository });

		if ('reason' in resolved) {
			result = { ...result, reason: resolved.reason };
		} else {
			const collector = collectGateObservations();
			const run = await runGates({
				cwd,
				config,
				coverage,
				packages: resolved.scope.packages,
				includeRoot: resolved.scope.includeRoot,
				runId,
				step: buildSelfCheckStep({ step }),
				schedule: { kind: GateScheduleKind.Exact, gates: gateNames },
				// This check runs inside the writing agent's own spawn and records no
				// verdict anywhere, so a machine another run holds ends it at once
				// rather than holding a paid session open for the full wait. Every
				// checkpoint that decides the run still waits the whole ceiling.
				waitForMachine: false,
				onGateResult: collector.onGateResult,
				onProgress,
			});
			const gates = collector.observed();
			// When every observation is a skip, nothing executed at all — which
			// `runGates` answers with an error naming `gate-overrides`, a block this
			// consumer may never have written and this caller never used. Judging from
			// the observations is what makes the answer honest without matching an
			// error string.
			const ranNothing = gates.every((observation) => observation.skipped === true);

			if (run.coordination !== undefined) {
				// Read before anything classifies this as a run that produced a
				// verdict: no gate command executed, so the answer is about the
				// machine rather than the change, and `ranNothing` — which asks
				// whether every observation is a skip — has nothing to say about it.
				result = { reason: SelfCheckReason.Coordination, gateNames, gates, error: undefined, crashes: [], coordination: run.coordination };
			} else {
				result = ranNothing
					? { ...result, gates }
					: { reason: SelfCheckReason.Ran, gateNames, gates, error: run.error, crashes: run.crashes, coordination: undefined };
			}
		}
	}

	return result;
};
