import type { summarizeRun } from '@/runState';
import { statusIcons } from '@/cli/common/constants/statusIcons';
import { formatDuration } from '@/cli/common/formatting/formatDuration';
import { formatTokenCount } from '@/cli/common/formatting/formatTokenCount';
import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';
import { paintStatus } from '@/cli/common/terminal/paintStatus';

interface Params {
	steps: Awaited<ReturnType<typeof summarizeRun>>['steps'];
	activeMs: number;
}

const paintCell = ({ text, padded, status }: { text: string; padded: string; status?: string }) => {
	if (text === '—') {
		return dim(padded);
	}

	if (status !== undefined && text.startsWith(statusIcons[status] ?? '?')) {
		return padded.replace(statusIcons[status] ?? '?', paintStatus({ status, text: statusIcons[status] ?? '?' }));
	}

	return padded;
};

export const printStepTable = ({ steps, activeMs }: Params): void => {
	const headers = ['step', 'tries', 'time', 'agents', 'out', 'cost', 'files'];
	const rows = steps.map((step) => ({
		status: step.status,
		cells: [
			`${statusIcons[step.status] ?? '?'} ${step.id}`,
			`${step.attempts}`,
			formatDuration({ ms: step.durationMs }),
			step.invocations > 0 ? `${step.invocations}` : '—',
			step.invocations > 0 ? formatTokenCount({ count: step.outputTokens }) : '—',
			step.invocations > 0 ? `$${step.costUsd.toFixed(2)}` : '—',
			step.changedFiles ? `${step.changedFiles.length}` : '—',
		],
	}));
	const invocations = steps.reduce((count, step) => count + step.invocations, 0);
	const totalCells = [
		'  total',
		'—',
		activeMs > 0 ? formatDuration({ ms: activeMs }) : '—',
		invocations > 0 ? `${invocations}` : '—',
		invocations > 0 ? formatTokenCount({ count: steps.reduce((count, step) => count + step.outputTokens, 0) }) : '—',
		invocations > 0 ? `$${steps.reduce((total, step) => total + step.costUsd, 0).toFixed(2)}` : '—',
		`${steps.reduce((count, step) => count + (step.changedFiles?.length ?? 0), 0)}`,
	];
	const allRows = [headers, ...rows.map((row) => row.cells), totalCells];
	const widths = headers.map((_, column) => Math.max(...allRows.map((cells) => (cells[column] ?? '').length)) + 2);
	const rule = (left: string, mid: string, right: string) => dim(`${left}${widths.map((width) => '─'.repeat(width)).join(mid)}${right}`);
	const renderRow = ({ cells, status, emphasis }: { cells: string[]; status?: string; emphasis?: (text: string) => string }) => {
		const rendered = cells.map((text, column) => {
			const width = widths[column] ?? 0;
			const padded = column === 0 ? ` ${text.padEnd(width - 1)}` : `${text.padStart(width - 1)} `;
			const painted = paintCell({ text, padded, status });

			return emphasis && text !== '—' ? emphasis(painted) : painted;
		});

		return `${dim('│')}${rendered.join(dim('│'))}${dim('│')}`;
	};

	console.log(rule('┌', '┬', '┐'));
	console.log(renderRow({ cells: headers }));

	for (const row of rows) {
		console.log(rule('├', '┼', '┤'));
		console.log(renderRow({ cells: row.cells, status: row.status }));
	}

	console.log(rule('├', '┼', '┤'));
	console.log(renderRow({ cells: totalCells, emphasis: bold }));
	console.log(rule('└', '┴', '┘'));
};
