import { jest } from '@jest/globals';
import type { ShipMergeMethod } from '#src/contracts/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { ShipStepFailure } from '#src/ship/common/types/ShipStepFailure.ts';
import type { CheckFailure, ChecksSummary, PullRequestSummary } from '#src/ship/forge/index.ts';

interface WaitParams {
	prNumber: number;
	cwd: string;
	allowNoCi: boolean;
	/** The exact candidate commit this attempt pushed — the only commit whose checks may count. */
	expectedHead: string;
	onProgress?: (message: string) => void;
}

interface MergeParams {
	prNumber: number;
	mergeMethod: ShipMergeMethod;
	cwd: string;
	expectedHead: string;
}

interface EvidenceParams {
	prNumber: number;
	commit: string;
	failingChecks: string[];
	cwd: string;
}

/**
 * The collaborators a scripted ship stands in for: the repository's own gates,
 * the forge, the check wait whose ceiling no arrangement can bring closer, and
 * the one git read no real arrangement can produce.
 *
 * Declared once here so a test file's `jest.mock` factories and
 * `setupShipScenario` reach the same functions. Jest gives each test file its
 * own module registry, so every file still gets a set of its own.
 */
export const mockShip = {
	runGates: jest.fn<(params: { cwd: string }) => Promise<GateRunResult>>(),
	waitForChecks: jest.fn<(params: WaitParams) => Promise<ChecksSummary>>(),
	readForgeAuth: jest.fn<(params: { cwd: string }) => Promise<boolean>>(),
	findPullRequest: jest.fn<(params: { branch: string; cwd: string }) => Promise<PullRequestSummary | undefined>>(),
	createPullRequest: jest.fn<(params: { branch: string; body: string; cwd: string }) => Promise<PullRequestSummary | ShipStepFailure>>(),
	mergePullRequest: jest.fn<(params: MergeParams) => Promise<string | ShipStepFailure>>(),
	readPullRequestChecks: jest.fn<(params: { prNumber: number; cwd: string }) => Promise<ChecksSummary | undefined>>(),
	readCheckFailureLogs: jest.fn<(params: EvidenceParams) => Promise<CheckFailure[] | undefined>>(),
	/**
	 * The one git read with no real arrangement behind it: a checkout whose branch
	 * name reads but whose HEAD does not cannot be built, because git answers both
	 * from the same unborn ref. Defaulted to the real reading by
	 * `setupShipScenario`, so only the test that is about an unnameable baseline
	 * sees anything different.
	 */
	readGitHeadCommit: jest.fn<(params: { cwd: string }) => Promise<string | undefined>>(),
};
