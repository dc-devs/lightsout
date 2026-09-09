import { maxCheapFixRetries } from '#src/common/constants/maxCheapFixRetries.ts';
import { ShipBlockReason } from '#src/contracts/index.ts';
import { type GateRunResult, runGates } from '#src/gates/index.ts';
import type { ShipIntegration } from '#src/ship/common/types/ShipIntegration.ts';
import { appendCommandOutput } from '#src/ship/common/utils/appendCommandOutput.ts';
import type { IntegrationFailure } from '#src/ship/integration/common/types/IntegrationFailure.ts';
import { invokeShipIntegrator } from '#src/ship/integration/invokeShipIntegrator.ts';
import { runPreShip } from '#src/ship/runPreShip.ts';

interface Params {
	cwd: string;
	integration: ShipIntegration;
	branch: string;
	defaultBranch: string;
	standards?: string;
	/** The configured release command, or undefined when the repository has no such convention. */
	preShip: string | undefined;
	/** The exact commit the default branch was pinned to, which preparation measures its version against. */
	baseCommit: string;
	onProgress?: (message: string) => void;
}

/** The verdict one full verification cycle reached: prepared and green, prepared and red, or never prepared at all. */
const verifyCandidate = async ({
	cwd,
	integration,
	preShip,
	baseCommit,
	onProgress,
}: Omit<Params, 'branch' | 'defaultBranch' | 'standards'>): Promise<{ blocked: IntegrationFailure } | { gates: GateRunResult }> => {
	const hookFailure = preShip === undefined ? undefined : await runPreShip({ cwd, command: preShip, baseCommit, onProgress });

	if (hookFailure !== undefined) {
		return {
			blocked: {
				reason: ShipBlockReason.PreShipFailed,
				detail: appendCommandOutput({ sentence: `the pre-ship command '${preShip}' failed`, stderr: hookFailure.stderr }),
				paths: [],
			},
		};
	}

	const gates = await runGates({ cwd, config: integration.config, coverage: true, includeRoot: true, onProgress });

	if (gates.crashes.length > 0) {
		return {
			blocked: {
				reason: ShipBlockReason.IntegrationGatesFailed,
				detail: [
					'a gate crashed instead of failing — the known jest worker SIGSEGV, not a verdict about the code.',
					'No repair was attempted and no repair attempt was spent.',
					gates.crashes.join('\n'),
					gates.error ?? '',
				].join('\n\n'),
				paths: [],
			},
		};
	}

	return { gates };
};

/**
 * The bounded gate recovery: prepare the release candidate, run the
 * repository's own gates against it, and hand a red result back to the agent
 * with its exact output.
 *
 * Preparation runs before EVERY verification, this attempt's first and each
 * repaired one after it, so the version a repair changes is still measured
 * against the same pinned base. This is the single hook invocation site of a
 * verification cycle — no caller runs it a second time.
 *
 * Gates run over the whole repository with coverage, rather than over a package
 * scope: the commits being integrated are not this branch's, and nothing has
 * narrowed which packages they touched.
 *
 * A gate that CRASHED is not handed to the agent and spends no attempt. Its red
 * is a toolchain fault rather than a verdict about the code, and presenting it
 * as one would spend a repair on a suite that is not broken — the same refusal
 * `runDirectWork` states.
 *
 * @returns undefined once the gates are green, else why the allowance ran out and which families stayed red
 */
export const repairIntegratedGates = async ({
	cwd,
	integration,
	branch,
	defaultBranch,
	standards,
	preShip,
	baseCommit,
	onProgress,
}: Params): Promise<IntegrationFailure | undefined> => {
	for (let attempt = 0; ; attempt += 1) {
		const verified = await verifyCandidate({ cwd, integration, preShip, baseCommit, onProgress });

		if ('blocked' in verified) {
			return verified.blocked;
		}

		const { error, failedFamilies } = verified.gates;

		if (error === undefined) {
			return undefined;
		}

		if (attempt === maxCheapFixRetries) {
			return { reason: ShipBlockReason.IntegrationGatesFailed, detail: error, paths: failedFamilies };
		}

		onProgress?.(`integrate: the gates are red — re-invoking the integrator with their output (fix ${attempt + 1} of ${maxCheapFixRetries})`);
		await invokeShipIntegrator({ cwd, integration, branch, defaultBranch, standards, errorContext: error });
	}
};
