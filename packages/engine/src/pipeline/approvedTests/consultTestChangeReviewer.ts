import { buildTestChangeReviewInvocation } from '#src/agents/index.ts';
import { defaultSupervisorTimeoutMinutes } from '#src/common/constants/defaultSupervisorTimeoutMinutes.ts';
import { type AcceptanceTestRecord, type LightsoutConfig, Permissions, TestChangeReview } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { type AgentOutcome, invokeAgentWithContract } from '#src/invoke/index.ts';
import type { TestChange } from '#src/pipeline/approvedTests/common/types/TestChange.ts';

const reviewerPermissions = Permissions.ReadOnly;

interface Params {
	driver: Driver;
	cwd: string;
	config: LightsoutConfig;
	planContent: string;
	overviewContent?: string;
	/** The verification checkpoint in flight. */
	checkpoint: string;
	/** The live acceptance-test mapping the reviewer must account for. */
	acceptanceTests: AcceptanceTestRecord[];
	/** Source files the run has changed so far. */
	changedFiles: string[];
	/** The checkpoint's change bundle — one entry per test-side file that differs from its approved version. */
	changes: TestChange[];
	onEvent?: (event: unknown) => void;
	onRejectedOutput?: (params: { text: string; attempt: number; validationError: string }) => Promise<void> | void;
}

/**
 * The independent judgment on this checkpoint's test-side changes: a read-only
 * reviewer rules on the whole bundle at once, against the plan.
 *
 * Its posture is engine-owned — read-only whatever the consumer's config grants,
 * and on the supervisor's timeout rather than the agent one, because it reads
 * and rules rather than building. Callers own usage recording and the verdict.
 *
 * It lives in this module rather than beside `consultSupervisor` because its
 * params carry the bundle entry type, which is this module's private shape.
 */
export const consultTestChangeReviewer = async ({
	driver,
	cwd,
	config,
	planContent,
	overviewContent,
	checkpoint,
	acceptanceTests,
	changedFiles,
	changes,
	onEvent,
	onRejectedOutput,
}: Params): Promise<AgentOutcome<TestChangeReview>> => {
	return invokeAgentWithContract({
		driver,
		cwd,
		invocation: buildTestChangeReviewInvocation({ planContent, overviewContent, checkpoint, acceptanceTests, changedFiles, changes }),
		contract: TestChangeReview,
		model: config.model,
		effort: config.effort,
		permissions: reviewerPermissions,
		timeoutMs: (config.timeouts?.['supervisor-minutes'] ?? defaultSupervisorTimeoutMinutes) * 60_000,
		onEvent,
		onRejectedOutput,
	});
};
