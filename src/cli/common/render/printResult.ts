import { basename } from 'node:path';
import { formatDuration } from '@/cli/common/formatting/formatDuration';
import { formatTokenCount } from '@/cli/common/formatting/formatTokenCount';
import { printStepTable } from '@/cli/common/render/printStepTable';
import { bold } from '@/cli/common/terminal/bold';
import { paintStatus } from '@/cli/common/terminal/paintStatus';
import type { PipelineResult } from '@/pipeline';
import { summarizeRun } from '@/runState';

interface Params {
	result: PipelineResult;
	cwd: string;
}

export const printResult = async ({ result, cwd }: Params): Promise<void> => {
	const { manifest, ok, error } = result;
	const summary = await summarizeRun({ cwd, manifest });
	const label = (name: string, value: string) => console.log(`${name.padEnd(10)}${value}`);
	const plural = (count: number) => (count === 1 ? '' : 's');

	console.log('');
	label('run', `${manifest.runId.slice(0, 8)} · ${paintStatus({ status: manifest.status, text: bold(manifest.status.toUpperCase()) })}`);
	label('plan', basename(manifest.plan));
	label('wall', formatDuration({ ms: summary.wallMs }));

	if (summary.activeMs > 0) {
		label('active', formatDuration({ ms: summary.activeMs }));
	}

	label('gates', formatDuration({ ms: summary.gateMs }));

	if (summary.usage && summary.usage.invocations > 0) {
		const { invocations, inputTokens, outputTokens, cacheReadTokens, costUsd } = summary.usage;
		const share = summary.cacheReadShare === undefined ? '' : ` (${Math.round(summary.cacheReadShare * 100)}%)`;

		label(
			'tokens',
			`in ${formatTokenCount({ count: inputTokens })} · out ${formatTokenCount({ count: outputTokens })} · cache-read ${formatTokenCount({ count: cacheReadTokens })}${share}`,
		);
		label('cost', `$${costUsd.toFixed(2)} API-equivalent · ${invocations} invocation${plural(invocations)}`);
	}

	console.log('');
	printStepTable({ steps: summary.steps, activeMs: summary.activeMs });
	console.log('');

	const gateParts = [`${summary.gates.commands} command${plural(summary.gates.commands)}`];

	if (summary.gates.reruns > 0) {
		gateParts.push(`${summary.gates.reruns} flake re-run${plural(summary.gates.reruns)}`);
	}

	if (summary.gates.skipped > 0) {
		gateParts.push(`${summary.gates.skipped} skipped (no script)`);
	}

	label('gates', gateParts.join(' · '));

	if (summary.rejectedReports > 0) {
		label('retries', `${summary.rejectedReports} rejected report${plural(summary.rejectedReports)} re-emitted`);
	}

	if (summary.frictionByArea.length > 0) {
		const total = summary.frictionByArea.reduce((count, entry) => count + entry.count, 0);

		label('friction', `${total} · ${summary.frictionByArea.map((entry) => `${entry.area} ${entry.count}`).join(' · ')}`);
	}

	if (manifest.packages.length > 0) {
		label('scope', `${manifest.packages.join(' · ')}${manifest.packagesSource ? ` (${manifest.packagesSource})` : ''}`);
	}

	label('evidence', `.lightsout/runs/${manifest.runId}/`);

	if (!ok && error) {
		console.error(`\n${error}`);
	}
};
