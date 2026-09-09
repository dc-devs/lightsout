import { buildShipIntegratorInvocation } from '#src/agents/index.ts';
import { defaultAgentTimeoutMinutes } from '#src/common/constants/defaultAgentTimeoutMinutes.ts';
import { WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { invokeAgentWithContract } from '#src/invoke/index.ts';
import type { ShipIntegration } from '#src/ship/common/types/ShipIntegration.ts';

interface Params {
	cwd: string;
	integration: ShipIntegration;
	branch: string;
	defaultBranch: string;
	standards?: string;
	/** The paths git left unmerged. Present on a conflict attempt, absent otherwise. */
	conflictPaths?: string[];
	ticketRef?: string;
	branchDiff?: string;
	ciEvidence?: string;
	/** Exact gate output from the failed verification. Present on a gate-repair attempt, absent otherwise. */
	errorContext?: string;
}

/**
 * One spawn of the ship-integrator role, validated against the shared work
 * contract.
 *
 * Answers `undefined` when the agent reported `complete`, and a one-line
 * reason otherwise — a refused contract, a rate-limited harness, or a report
 * whose status is anything else. One line and not the whole report, because
 * the caller is bounding attempts rather than reading a transcript.
 *
 * Every failure is a value here. A harness that will not answer costs the same
 * bounded attempt a wrong answer costs, instead of escaping as an exception
 * through a caller that is standing in an open merge.
 *
 * @returns undefined when the role completed, else the first line of why it did not
 */
export const invokeShipIntegrator = async ({
	cwd,
	integration,
	branch,
	defaultBranch,
	standards,
	conflictPaths,
	ticketRef,
	branchDiff,
	ciEvidence,
	errorContext,
}: Params): Promise<string | undefined> => {
	const { config, driver } = integration;
	const allowedCommands = config['agent-commands'];
	const outcome = await invokeAgentWithContract({
		driver,
		cwd,
		invocation: buildShipIntegratorInvocation({
			branch,
			defaultBranch,
			standards,
			allowedCommands,
			ticketRef,
			conflictPaths,
			branchDiff,
			ciEvidence,
			errorContext,
		}),
		contract: WorkReport,
		model: config.model,
		effort: config.effort,
		permissions: config.permissions,
		timeoutMs: (config.timeouts?.['agent-minutes'] ?? defaultAgentTimeoutMinutes) * 60_000,
		allowedCommands,
	});

	if (!outcome.ok) {
		return outcome.failure;
	}

	const report: WorkReport = outcome.report;

	return report.status === WorkReportStatus.Complete ? undefined : (report.failures[0] ?? report.summary);
};
