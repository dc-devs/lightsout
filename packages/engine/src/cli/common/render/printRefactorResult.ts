import { printBatchLine } from '#src/cli/common/render/printBatchLine.ts';
import { printBatchOptOut } from '#src/cli/common/render/printBatchOptOut.ts';
import { printRunFooter } from '#src/cli/common/render/printRunFooter.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import { RunStatus } from '#src/contracts/index.ts';
import type { RefactorResult } from '#src/refactor/index.ts';

interface Params {
	result: RefactorResult;
}

/**
 * Render a finished refactor run: the status line, one line per batch, the
 * agent's own rationale for every decline, the per-rule burn-down, and
 * where the evidence landed. Reporting only — the command owns the exit code,
 * so this stays callable from a test without ending the process.
 */
export const printRefactorResult = ({ result }: Params): void => {
	const { manifest, declined, before, after } = result;
	const batchSteps = manifest.steps.filter((step) => step.id.startsWith('batch-'));
	const statusLabel = result.ok && declined.length > 0 ? `${manifest.status.toUpperCase()} · ${declined.length} declined` : manifest.status.toUpperCase();

	console.log(`\n${bold(`refactor ${manifest.runId.slice(0, 8)}`)} — ${statusLabel}`);

	for (const step of batchSteps) {
		const decline = declined.find((entry) => entry.batchId === step.id);

		printBatchLine({
			step,
			optedOut: decline !== undefined,
			label: decline ? `declined (${decline.remainingSiteKeys.length} site(s) persist)` : step.status === RunStatus.Passed ? 'resolved' : step.status,
		});
	}

	for (const entry of declined) {
		printBatchOptOut({
			heading: 'declined',
			batchId: entry.batchId,
			lines: entry.rationale,
			hint: 'review each site — fix by hand, or accept it as debt: lightsout standards-check --baseline',
		});
	}

	const rules = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();

	// A parked run takes no final standards check — its `after` merely echoes
	// `before`, and printing that as a burn-down reads as "nothing improved".
	if (!result.ok) {
		console.log(dim('\nno burn-down until the run completes — resume to finish and measure'));
	} else if (rules.length > 0) {
		console.log('\nburn-down (findings before → after):');

		for (const rule of rules) {
			console.log(`  ${rule.padEnd(20)}${before[rule] ?? 0} → ${after[rule] ?? 0}`);
		}
	}

	printRunFooter({ manifest, ending: result.ok ? undefined : result.error });
};
