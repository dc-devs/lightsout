import type { GateRunResult } from '#src/gates/index.ts';
import type { ShipStepFailure } from '#src/ship/common/types/ShipStepFailure.ts';
import type { CheckFailure, ChecksSummary, PullRequestSummary } from '#src/ship/forge/index.ts';

const branch = 'lo-89-ship';

/**
 * The worlds a scripted ship meets, as one vocabulary both the scenario factory
 * and the cases built on it read from.
 *
 * One copy rather than one per test file, so two files cannot disagree about
 * what "the checks came back red" or "the forge refused on a newer base" means.
 */
export const shipScenarioFixtures: {
	branch: string;
	conflictPath: string;
	author: string;
	green: GateRunResult;
	greenChecks: ChecksSummary;
	missingChecks: ChecksSummary;
	redChecks: ChecksSummary;
	mergedCommit: string;
	staleBase: ShipStepFailure;
	pullRequest: PullRequestSummary;
	ciFailure: CheckFailure;
} = {
	branch,
	/** The one file both sides edit, so merging the default branch in has to conflict. */
	conflictPath: 'shared.ts',
	author: '-c user.name=t -c user.email=t@t',
	green: { error: undefined, failedFamilies: [], crashes: [] },
	greenChecks: { finished: true, green: true, failing: [], pending: [], passing: ['unit'], readable: true },
	/** A readable observation listing no checks at all at the wait ceiling — absent CI, not a timeout. */
	missingChecks: { finished: false, green: true, failing: [], pending: [], passing: [], readable: true },
	redChecks: { finished: true, green: false, failing: ['unit'], pending: [], passing: [], readable: true },
	mergedCommit: '0f1e2d3c',
	/** A refusal the forge's structured state confirmed is only a newer base — the one refusal another attempt may answer. */
	staleBase: { stderr: 'Base branch was modified. Review and try the merge again.', staleBase: true },
	pullRequest: {
		number: 41,
		url: 'https://forge.example/acme/repo/pull/41',
		title: 'Centralize ship integration',
		branch,
	},
	ciFailure: {
		name: 'unit',
		runId: 77,
		commit: 'read back from the pushed candidate',
		output: 'unit\tAssertionError: expected 3 to be 4',
	},
};
