import { printBatchLine } from '#src/cli/common/render/printBatchLine.ts';
import { printBatchOptOut } from '#src/cli/common/render/printBatchOptOut.ts';
import { printRunFooter } from '#src/cli/common/render/printRunFooter.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import { RunStatus } from '#src/contracts/index.ts';
import type { CoverageResult } from '#src/coverage/index.ts';

interface Params {
	result: CoverageResult;
}

/**
 * Render a finished coverage run: the status line, one line per batch, every
 * set-aside file with the agent's own reason, the per-scope before → after
 * table, and where the evidence landed. Reporting only — the command owns the
 * exit code, so this stays callable from a test without ending the process.
 */
export const printCoverageResult = ({ result }: Params): void => {
	const { manifest, setAside, before, after } = result;
	const batchSteps = manifest.steps.filter((step) => step.id.startsWith('batch-'));
	const statusLabel = setAside.length > 0 ? `${manifest.status.toUpperCase()} · ${setAside.length} set aside` : manifest.status.toUpperCase();

	console.log(`\n${bold(`test-coverage-to-threshold ${manifest.runId.slice(0, 8)}`)} — ${statusLabel}`);

	for (const step of batchSteps) {
		const aside = setAside.find((entry) => entry.batchId === step.id);

		printBatchLine({
			step,
			optedOut: aside !== undefined,
			label: aside ? `declined (${aside.files.length} file(s) set aside)` : step.status === RunStatus.Passed ? 'resolved' : step.status,
		});
	}

	for (const entry of setAside) {
		printBatchOptOut({
			heading: 'set aside',
			batchId: entry.batchId,
			lines: [...entry.files, ...entry.rationale],
			hint: 'these files likely need source changes — raise coverage by hand or adjust the threshold',
		});
	}

	const scopes = [...new Set([...before.map((total) => total.scope), ...after.map((total) => total.scope)])].sort();

	// A parked run takes no final measurement — its `after` merely echoes
	// `before`, and printing that reads as "nothing improved".
	if (!result.ok) {
		console.log(dim('\nno final measure until the run completes — resume to finish and measure'));
	} else if (scopes.length > 0) {
		console.log('\ncoverage (statements before → after):');

		for (const scope of scopes) {
			const from = before.find((total) => total.scope === scope);
			const to = after.find((total) => total.scope === scope);

			console.log(`  ${scope.padEnd(20)}${from?.statementsPct ?? 0} → ${to?.statementsPct ?? 0}`);
		}
	}

	printRunFooter({ manifest, error: result.ok ? undefined : result.error });
};
