import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { isTestSideFile } from '#src/common/sourceFiles/isTestSideFile.ts';
import { RunStatus } from '#src/contracts/index.ts';
import { checkTestResultsCapability } from '#src/gates/index.ts';
import { approveTestFiles } from '#src/pipeline/approvedTests/index.ts';
import { runVerificationGates } from '#src/pipeline/common/utils/runVerificationGates.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';

interface Params {
	run: PipelineRun;
	/** The distinct gate keys the plan's acceptance ledger names; empty when the plan carries no ledger. */
	ledgerGates: string[];
}

/**
 * The clean-slate gate: the codebase must be green before implementation.
 * Coverage runs here too — verify-tests holds the same bar later, so a
 * baseline that already misses it must be the consumer's problem, not the
 * run's.
 *
 * A plan with an acceptance ledger also has its per-test evidence probed here,
 * once the gates are green: this is the last free moment. After it the run
 * starts paying for agents, and a repository whose jest config never loads the
 * engine's reporter would otherwise not find that out until its final
 * checkpoint, having bought every agent turn in between.
 */
export const cleanSlateStep = ({ run, ledgerGates }: Params): PipelineStep['run'] => {
	return async () => {
		const record = run.nextRecord({ id: 'clean-slate' });

		await run.setStep({ record });
		run.progress(`step clean-slate — attempt ${record.attempts}`);

		// No acceptance rows here: the ledger's tests have not been written yet, so
		// every one of them would read as a test that never ran.
		const { error, failures, gates } = await runVerificationGates({ run, coverage: true, checkpoint: 'clean-slate', rows: [] });

		if (error) {
			// A gate that never finished is a different problem from a gate that
			// ran and went red, and the two want different first moves from a
			// human: raise the ceiling or free the machine, versus fix the code.
			// `createGateRunner` records a timeout or a failed spawn as exit -1.
			const ranOut = failures.some((failure) => failure.exitCode === -1);
			const headline = ranOut
				? 'A gate did not finish, so the codebase was never proved green — this is a timeout or a gate that could not start, not a failing test.'
				: 'Codebase is not green before implementation — fix this first.';

			return run.stop({ record, status: RunStatus.Failed, error: `${headline}\n${error}` });
		}

		const capability =
			ledgerGates.length === 0
				? undefined
				: await checkTestResultsCapability({ cwd: run.cwd, gates: ledgerGates, results: gates ?? [], onProgress: (message) => run.progress(message) });

		if (capability) {
			return run.stop({ record, status: RunStatus.Failed, error: capability });
		}

		// Gate commands may produce artifacts (coverage output, logs). Fold
		// anything that appeared during clean-slate into the baseline so it is
		// never attributed to the run's agents.
		const gateArtifacts = await readGitChangedFiles({ cwd: run.cwd });
		const baselineDirtyFiles = [...new Set([...run.current().baselineDirtyFiles, ...(gateArtifacts ?? [])])];
		// The last moment the tree is known to be the state the run started from,
		// and so the one place outside the ledger step and the review where an
		// approval happens: dirt that predates the first agent turn is approved
		// here, or the first checkpoint with a bundle would put it in front of the
		// reviewer as somebody's edit to a test.
		const approvedTests = await approveTestFiles({ run, paths: baselineDirtyFiles.filter((path) => isTestSideFile({ path })) });

		await run.setStep({ record: { ...record, status: RunStatus.Passed }, patch: { baselineDirtyFiles, approvedTests } });
		run.progress('step clean-slate passed');

		return undefined;
	};
};
