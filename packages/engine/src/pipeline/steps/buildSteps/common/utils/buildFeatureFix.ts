import { buildFeatureExecutorInvocation } from '#src/agents/buildFeatureExecutorInvocation.ts';
import type { RenameRule } from '#src/contracts/plan/renames/RenameRule.ts';
import type { AcceptanceTestRecord } from '#src/contracts/run/AcceptanceTestRecord.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { FixBuilder } from '#src/pipeline/steps/common/types/FixBuilder.ts';

interface Params {
	run: PipelineRun;
	planContent: string;
	overviewContent?: string;
	standards?: string;
	fileLimit: number | undefined;
	/** Read at every call rather than captured once. */
	acceptanceTests: () => AcceptanceTestRecord[];
	renames: RenameRule[];
	selfCheckCommand: string;
}

/**
 * The feature executor's fix re-invocation. Verify-implement hands its red to it
 * for every plan, and a rename-only plan's verify-tests does too — a unit-test
 * writer would be sent to repair a phase that must write no tests.
 *
 * It must receive the same `selfCheckCommand` and `renames` as the implement
 * step's own spawn: the two differ only in the user prompt, and a section on one
 * but not the other would split the role's cached system prompt in two.
 */
export const buildFeatureFix =
	({ run, planContent, overviewContent, standards, fileLimit, acceptanceTests, renames, selfCheckCommand }: Params): FixBuilder =>
	({ errorContext }) =>
		buildFeatureExecutorInvocation({
			planContent,
			overviewContent,
			standards,
			errorContext,
			changedFiles: run.current().changedFiles,
			allowedCommands: run.config['agent-commands'],
			fileLimit,
			acceptanceTests: acceptanceTests(),
			selfCheckCommand,
			renames,
		});
