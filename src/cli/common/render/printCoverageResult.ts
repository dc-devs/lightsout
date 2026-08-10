import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';
import { green } from '@/cli/common/terminal/green';
import { red } from '@/cli/common/terminal/red';
import { yellow } from '@/cli/common/terminal/yellow';
import { RunStatus } from '@/contracts';
import type { CoverageResult } from '@/coverage';

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
		const icon = step.status !== RunStatus.Passed ? red('✗') : aside ? yellow('⤫') : green('✓');
		const label = aside ? `declined (${aside.files.length} file(s) set aside)` : step.status === RunStatus.Passed ? 'resolved' : step.status;

		console.log(`${icon} ${step.id.padEnd(48)}${label}${step.changedFiles?.length ? dim(` · ${step.changedFiles.length} file(s)`) : ''}`);
	}

	for (const entry of setAside) {
		console.log(`\n${yellow('set aside')} ${entry.batchId}`);

		for (const file of entry.files) {
			console.log(dim(`  ${file}`));
		}

		for (const line of entry.rationale) {
			console.log(dim(`  ${line}`));
		}

		console.log(dim('  these files likely need source changes — raise coverage by hand or adjust the threshold'));
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

	if (manifest.changedFiles.length > 0) {
		console.log(`\n${manifest.changedFiles.length} file(s) changed in the working tree — review and commit; the engine never commits.`);
	}

	console.log(`evidence: .lightsout/runs/${manifest.runId}/`);

	if (!result.ok && result.error) {
		console.error(`\n${result.error}`);
	}
};
