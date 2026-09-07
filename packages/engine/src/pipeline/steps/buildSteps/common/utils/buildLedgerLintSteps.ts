import { RunStatus } from '#src/contracts/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';

interface Params {
	run: PipelineRun;
	/** The plan lines whose acceptance-test ledger rows the engine could not read. */
	malformedLines: number[];
}

/**
 * A plan whose ledger rows are malformed stops the run before anything else: the
 * plan-time lint gives that verdict, and implement must not be more lenient
 * about it. A well-formed ledger contributes no step at all.
 */
export const buildLedgerLintSteps = ({ run, malformedLines }: Params): PipelineStep[] =>
	malformedLines.length === 0
		? []
		: [
				{
					id: 'check-ledger',
					run: async () =>
						run.stop({
							record: run.nextRecord({ id: 'check-ledger' }),
							status: RunStatus.Failed,
							error: `check-ledger: the plan's acceptance-test ledger has row(s) the engine cannot read, at line(s) ${malformedLines.join(', ')} — fix them in the plan and re-run.`,
						}),
				},
			];
