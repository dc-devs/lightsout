import { ShipBlockReason } from '#src/contracts/index.ts';
import type { ShipAttemptResult } from '#src/ship/common/types/ShipAttemptResult.ts';
import type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';
import type { ShipStopFields } from '#src/ship/common/types/ShipStopFields.ts';
import { createBlockedAttempt } from '#src/ship/common/utils/createBlockedAttempt.ts';
import { hasNoChecks } from '#src/ship/common/utils/hasNoChecks.ts';
import { type CheckFailure, readCheckFailureLogs } from '#src/ship/forge/index.ts';
import { waitForChecks } from '#src/ship/waitForChecks.ts';

interface Params {
	prNumber: number;
	candidate: string;
	cwd: string;
	settings: ShipSettings;
	stop: ShipStopFields;
	onProgress?: (message: string) => void;
}

/** The failing runs' output, as one block of diagnostic data the repair attempt is handed. */
const describeEvidence = ({ evidence }: { evidence: CheckFailure[] }) =>
	evidence.map((failure) => `## ${failure.name} (run ${failure.runId}, commit ${failure.commit})\n\n${failure.output}`).join('\n\n');

/** What the checks came back as, folded into the stop the sequence owes for it — or nothing, when they were green. */
export const readCheckStop = async ({ prNumber, candidate, cwd, settings, stop, onProgress }: Params): Promise<ShipAttemptResult | undefined> => {
	const checks = await waitForChecks({ prNumber, cwd, allowNoCi: settings.allowNoCi, expectedHead: candidate, onProgress });

	// Read successfully AND listing nothing is the one observation that means
	// this repository has no CI, as against one that could not be read.
	if (!checks.finished && checks.readable && hasNoChecks({ summary: checks })) {
		return createBlockedAttempt({
			stop,
			reason: ShipBlockReason.ChecksMissing,
			detail:
				'No CI checks appeared for this commit. If this repository intentionally has no CI, set ship.allow-no-ci to true in lightsout.config.json, commit the change, and rerun ship.',
		});
	}

	if (!checks.finished) {
		return createBlockedAttempt({
			stop,
			reason: ShipBlockReason.ChecksTimedOut,
			detail: 'checks were still running at the wait ceiling',
			failingChecks: checks.pending,
		});
	}

	if (checks.green) {
		return undefined;
	}

	const evidence = await readCheckFailureLogs({ prNumber, commit: candidate, failingChecks: checks.failing, cwd });

	return createBlockedAttempt({
		stop,
		reason: ShipBlockReason.ChecksFailed,
		detail:
			evidence === undefined
				? 'one or more checks finished red, and no failure evidence for this commit could be read — nothing was guessed at'
				: 'one or more checks finished red; the failing run’s own output was handed to the next attempt',
		failingChecks: checks.failing,
		retryable: evidence !== undefined,
		ciEvidence: evidence === undefined ? undefined : describeEvidence({ evidence }),
	});
};
