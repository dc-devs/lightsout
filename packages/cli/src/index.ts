import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { RunStatus, type LightsoutConfig } from '@lightsout/contracts';
import { getDriver, type Driver } from '@lightsout/drivers';
import {
	isPidAlive,
	loadConfig,
	readFriction,
	readRunLock,
	readRunManifest,
	runImplementPipeline,
	RunLockError,
	runPromptImprovement,
	summarizeRun,
	type PipelineResult,
} from '@lightsout/engine';

const usage = `lightsout — deterministic engine for coding agents

usage:
  lightsout run --plan <path> [--overview <path>] [--packages <a,b>] [--cwd <path>] [--skip-refactor]
  lightsout resume --run <id> [--cwd <path>] [--skip-refactor]
  lightsout status [--cwd <path>]
  lightsout friction [--cwd <path>]
  lightsout improve --engine <lightsout-repo-path> [--cwd <path>]
`;

const statusIcons: Record<string, string> = {
	[RunStatus.Passed]: '✓',
	[RunStatus.Failed]: '✗',
	[RunStatus.Running]: '…',
	[RunStatus.Pending]: '○',
	[RunStatus.PausedRateLimit]: '⏸',
	[RunStatus.Escalated]: '⚑',
};

const parseFlags = ({ args }: { args: string[] }) => {
	const flags = new Map<string, string | true>();

	let index = 0;

	while (index < args.length) {
		const key = args[index];

		if (!key?.startsWith('--')) {
			index += 1;
			continue;
		}

		const value = args[index + 1];

		if (value === undefined || value.startsWith('--')) {
			flags.set(key.slice(2), true);
			index += 1;
		} else {
			flags.set(key.slice(2), value);
			index += 2;
		}
	}

	return flags;
};

const getStringFlag = ({ flags, name }: { flags: Map<string, string | true>; name: string }) => {
	const value = flags.get(name);

	return typeof value === 'string' ? value : undefined;
};

const describeStandards = ({ value, token }: { value: string[] | false | undefined; token: string }) => {
	if (value === false) {
		return 'none (explicit)';
	}

	if (value === undefined) {
		return `lightsout js defaults (none configured — set to false to disable, or list files/${token})`;
	}

	return value.join(', ');
};

const printRunHeader = ({ config, driver, cwd }: { config: LightsoutConfig; driver: Driver; cwd: string }) => {
	const coverage = config.scripts.testCoverage === false ? 'off (explicit)' : config.scripts.testCoverage;

	console.log(`  cwd: ${cwd}`);
	console.log(`  standards: ${describeStandards({ value: config.standards, token: 'lightsout:code-defaults' })}`);
	console.log(`  test standards: ${describeStandards({ value: config.testStandards, token: 'lightsout:test-defaults' })}`);
	console.log(
		`  driver: ${driver.name} · model: ${config.model ?? 'harness default'} · permissions: ${config.permissionMode ?? 'acceptEdits'}`,
	);
	console.log(`  timeouts: agent ${config.timeouts?.agentMinutes ?? 60}m · supervisor ${config.timeouts?.supervisorMinutes ?? 15}m`);
	console.log(`  gates (root): check=[${config.scripts.check}] testUnit=[${config.scripts.testUnit}] coverage=[${coverage}]`);

	if (config.scripts.generate) {
		console.log(`  generate (before every gate set): [${config.scripts.generate}]`);
	}

	if (config.agentCommands && config.agentCommands.length > 0) {
		console.log(`  agent commands (granted, prefix match): ${config.agentCommands.map((command) => `[${command}]`).join(' ')}`);
	}

	if (config.generated) {
		console.log(`  generated (never attributed): ${config.generated.join(', ')}`);
	}

	if (config.scripts.build) {
		console.log(`  gates (root, opt-in): build=[${config.scripts.build}]`);
	}

	if (config.scripts.format) {
		console.log(`  format: [${config.scripts.format}]`);
	}

	if (config.packageScripts) {
		const scopedCoverage = config.packageScripts.testCoverage ? ` coverage=[${config.packageScripts.testCoverage}]` : '';

		console.log(`  gates (per package): check=[${config.packageScripts.check}] testUnit=[${config.packageScripts.testUnit}]${scopedCoverage}`);
	}
};

const createProgressPrinter = () => {
	const startedAt = Date.now();

	return (message: string) => {
		const seconds = Math.round((Date.now() - startedAt) / 1000);

		console.log(`[+${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}] ${message}`);
	};
};

/** Run the pipeline; a RunLockError is a clean fail-fast message (no stack, no run state was created). */
const runPipelineOrFailFast = async (params: Parameters<typeof runImplementPipeline>[0]) => {
	try {
		return await runImplementPipeline(params);
	} catch (error) {
		if (error instanceof RunLockError) {
			console.error(`\n${error.message}`);
			process.exit(1);
		}

		throw error;
	}
};

const formatDuration = (ms?: number) => {
	if (ms === undefined) {
		return '—';
	}

	const seconds = Math.round(ms / 1000);

	return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
};

const formatTokenCount = (count: number) => {
	if (count >= 1_000_000) {
		return `${(count / 1_000_000).toFixed(1)}M`;
	}

	return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`;
};

// ANSI paint, no-op when output is piped — alignment is computed on plain
// text first, so color codes never disturb the table geometry.
const paint = (code: string) => (text: string) => (process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text);
const dim = paint('2');
const bold = paint('1');
const green = paint('32');
const red = paint('31');
const yellow = paint('33');

const paintStatus = (status: string, text: string) => {
	if (status === RunStatus.Passed) {
		return green(text);
	}

	return status === RunStatus.Failed ? red(text) : yellow(text);
};

const paintCell = ({ text, padded, status }: { text: string; padded: string; status?: string }) => {
	if (text === '—') {
		return dim(padded);
	}

	if (status !== undefined && text.startsWith(statusIcons[status] ?? '?')) {
		return padded.replace(statusIcons[status] ?? '?', paintStatus(status, statusIcons[status] ?? '?'));
	}

	return padded;
};

const printStepTable = ({ steps, activeMs }: { steps: Awaited<ReturnType<typeof summarizeRun>>['steps']; activeMs: number }) => {
	const headers = ['step', 'tries', 'time', 'agents', 'out', 'cost', 'files'];
	const rows = steps.map((step) => ({
		status: step.status,
		cells: [
			`${statusIcons[step.status] ?? '?'} ${step.id}`,
			`${step.attempts}`,
			formatDuration(step.durationMs),
			step.invocations > 0 ? `${step.invocations}` : '—',
			step.invocations > 0 ? formatTokenCount(step.outputTokens) : '—',
			step.invocations > 0 ? `$${step.costUsd.toFixed(2)}` : '—',
			step.changedFiles ? `${step.changedFiles.length}` : '—',
		],
	}));
	const invocations = steps.reduce((count, step) => count + step.invocations, 0);
	const totalCells = [
		'  total',
		'—',
		activeMs > 0 ? formatDuration(activeMs) : '—',
		invocations > 0 ? `${invocations}` : '—',
		invocations > 0 ? formatTokenCount(steps.reduce((count, step) => count + step.outputTokens, 0)) : '—',
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

const printResult = async ({ result, cwd }: { result: PipelineResult; cwd: string }) => {
	const { manifest, ok, error } = result;
	const summary = await summarizeRun({ cwd, manifest });
	const label = (name: string, value: string) => console.log(`${name.padEnd(10)}${value}`);
	const plural = (count: number) => (count === 1 ? '' : 's');

	console.log('');
	label('run', `${manifest.runId.slice(0, 8)} · ${paintStatus(manifest.status, bold(manifest.status.toUpperCase()))}`);
	label('plan', basename(manifest.plan));
	label('wall', formatDuration(summary.wallMs));

	if (summary.activeMs > 0) {
		label('active', formatDuration(summary.activeMs));
	}

	label('gates', formatDuration(summary.gateMs));

	if (summary.usage && summary.usage.invocations > 0) {
		const { invocations, inputTokens, outputTokens, cacheReadTokens, costUsd } = summary.usage;
		const share = summary.cacheReadShare === undefined ? '' : ` (${Math.round(summary.cacheReadShare * 100)}%)`;

		label('tokens', `in ${formatTokenCount(inputTokens)} · out ${formatTokenCount(outputTokens)} · cache-read ${formatTokenCount(cacheReadTokens)}${share}`);
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

const main = async () => {
	const [command, ...rest] = process.argv.slice(2);
	const flags = parseFlags({ args: rest });
	const cwd = getStringFlag({ flags, name: 'cwd' }) ?? process.cwd();
	const skipRefactor = flags.get('skip-refactor') === true;

	if (command === 'run') {
		const planPath = getStringFlag({ flags, name: 'plan' });
		const overviewPath = getStringFlag({ flags, name: 'overview' });
		const packagesFlag = getStringFlag({ flags, name: 'packages' });
		const packages = packagesFlag
			? packagesFlag
					.split(',')
					.map((name) => name.trim())
					.filter(Boolean)
			: undefined;

		if (!planPath) {
			console.error(usage);
			process.exit(1);
		}

		const config = await loadConfig({ cwd });
		const driver = getDriver({ name: config.driver ?? 'claude-code' });

		console.log(`lightsout: starting run`);
		console.log(`  plan: ${planPath}${overviewPath ? `\n  overview: ${overviewPath}` : ''}${packages ? `\n  packages flag: ${packages.join(', ')}` : ''}`);
		printRunHeader({ config, driver, cwd });

		const result = await runPipelineOrFailFast({
			cwd,
			planPath,
			overviewPath,
			packages,
			driver,
			config,
			skipRefactor,
			onProgress: createProgressPrinter(),
		});

		await printResult({ result, cwd });
		process.exit(result.ok ? 0 : 1);
	}

	if (command === 'resume') {
		const runId = getStringFlag({ flags, name: 'run' });

		if (!runId) {
			console.error(usage);
			process.exit(1);
		}

		const manifest = await readRunManifest({ cwd, runId });

		if (manifest.status === RunStatus.Passed) {
			console.error(`run ${runId} already passed — nothing to resume`);
			process.exit(1);
		}

		const config = await loadConfig({ cwd });
		const driver = getDriver({ name: manifest.driver });

		console.log(`lightsout: resuming run ${runId} (was: ${manifest.status}, plan: ${manifest.plan})`);
		printRunHeader({ config, driver, cwd });

		const result = await runPipelineOrFailFast({
			cwd,
			driver,
			config,
			existing: manifest,
			skipRefactor,
			onProgress: createProgressPrinter(),
		});

		await printResult({ result, cwd });
		process.exit(result.ok ? 0 : 1);
	}

	if (command === 'status') {
		const runsDir = join(cwd, '.lightsout', 'runs');
		const runIds = await readdir(runsDir).catch(() => []);

		if (runIds.length === 0) {
			console.log('no runs found');
			process.exit(0);
		}

		const lock = await readRunLock({ cwd });

		for (const runId of runIds) {
			const manifest = await readRunManifest({ cwd, runId }).catch(() => undefined);

			if (manifest) {
				// A `running` manifest with no live process behind it is a crash
				// leftover (killed terminal, uncaught error) — resumable, not lost.
				const zombie =
					manifest.status === RunStatus.Running &&
					!(lock && lock.runId === manifest.runId && isPidAlive({ pid: lock.pid }));
				const status = zombie ? `${manifest.status} (no live process — crashed? resume with --run ${manifest.runId})` : manifest.status;

				console.log(`${manifest.runId}  ${status}  plan: ${manifest.plan}  updated: ${manifest.updatedAt}`);
			}
		}

		process.exit(0);
	}

	if (command === 'friction') {
		const entries = await readFriction({ cwd });

		if (entries.length === 0) {
			console.log('no friction recorded');
			process.exit(0);
		}

		for (const entry of entries) {
			console.log(`[${entry.area}] (run ${entry.runId.slice(0, 8)}, ${entry.step}, ${entry.at}) ${entry.detail}`);
		}

		process.exit(0);
	}

	if (command === 'improve') {
		const engineCwd = getStringFlag({ flags, name: 'engine' });

		if (!engineCwd) {
			console.error(usage);
			process.exit(1);
		}

		const driver = getDriver({ name: 'claude-code' });
		const result = await runPromptImprovement({ consumerCwd: cwd, engineCwd, driver });

		if (result.friction.length === 0) {
			console.log('no friction recorded — nothing to improve from');
			process.exit(0);
		}

		if (result.rateLimited || !result.report) {
			console.error(result.failure ?? 'improver produced no valid report');
			process.exit(1);
		}

		console.log(`\nimprove: ${result.report.status} (${result.friction.length} friction entries considered)`);
		console.log(`  ${result.report.summary}`);

		for (const file of result.report.changedFiles) {
			console.log(`  ~ ${file.path} — ${file.summary}`);
		}

		if (result.report.changedFiles.length > 0) {
			console.log(`\nreview the diff in ${engineCwd} — the loop proposes, a human ships.`);
		}

		process.exit(result.report.status === 'complete' ? 0 : 1);
	}

	console.error(usage);
	process.exit(command === undefined || command === 'help' ? 0 : 1);
};

await main();
