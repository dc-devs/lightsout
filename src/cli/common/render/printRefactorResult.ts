import { RunStatus } from '@/contracts';
import type { RefactorResult } from '@/refactor';
import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';
import { green } from '@/cli/common/terminal/green';
import { red } from '@/cli/common/terminal/red';
import { yellow } from '@/cli/common/terminal/yellow';

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
		const icon = step.status !== RunStatus.Passed ? red('✗') : decline ? yellow('⤫') : green('✓');
		const label = decline ? `declined (${decline.remainingClusters.length} cluster(s) persist)` : step.status === RunStatus.Passed ? 'resolved' : step.status;

		console.log(`${icon} ${step.id.padEnd(48)}${label}${step.changedFiles?.length ? dim(` · ${step.changedFiles.length} file(s)`) : ''}`);
	}

	for (const entry of declined) {
		console.log(`\n${yellow('declined')} ${entry.batchId}`);

		for (const line of entry.rationale) {
			console.log(dim(`  ${line}`));
		}

		console.log(dim(`  review each cluster — fix by hand, or accept it as debt: lightsout scan --baseline`));
	}

	const rules = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();

	// A parked run takes no final scan — its `after` merely echoes `before`,
	// and printing that as a burn-down reads as "nothing improved".
	if (!result.ok) {
		console.log(dim(`\nno burn-down until the run completes — resume to finish and measure`));
	} else if (rules.length > 0) {
		console.log(`\nburn-down (findings before → after):`);

		for (const rule of rules) {
			console.log(`  ${rule.padEnd(20)}${before[rule] ?? 0} → ${after[rule] ?? 0}`);
		}
	}

	if (manifest.changedFiles.length > 0) {
		console.log(`\n${manifest.changedFiles.length} file(s) changed in the working tree — review and commit; the engine never commits.`);
	}

	console.log(`evidence: .lightsout/runs/${manifest.runId}/`);

	if (!result.ok && result.error) {
		console.error(`\n${result.error}`);
	}
};
