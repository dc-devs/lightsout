import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { EdgeInventory, MapJoin, PlanVariant, RunStatus, TraverseMode, type LightsoutConfig } from '@lightsout/contracts';
import { getDriver, type Driver } from '@lightsout/drivers';
import {
	authorConnectionDocs,
	detectStandardsChannels,
	draftConnectionDocs,
	isPidAlive,
	loadConfig,
	readConnectionMap,
	readFriction,
	readRunLock,
	readRunManifest,
	readStandards,
	renderTrace,
	resolvePlansDir,
	runBuildMap,
	runDoctor,
	runImplementPipeline,
	runPlanDedup,
	runPlanDraft,
	runPlanExplore,
	runPlanGrade,
	runScan,
	RunLockError,
	runPromptImprovement,
	runTraverse,
	resolveConnectionsSource,
	summarizeRun,
	verifyConnectionAnchors,
	type PipelineResult,
} from '@lightsout/engine';

const usage = `lightsout — deterministic engine for coding agents

usage:
  lightsout implement --plan <path> [--overview <path>] [--packages <a,b>] [--cwd <path>] [--skip-refactor]
  lightsout resume --run <id> [--cwd <path>] [--skip-refactor]
  lightsout status [--cwd <path>]
  lightsout doctor [--cwd <path>]
  lightsout scan [--cwd <path>] [--path <subdir>] [--all] [--baseline]
  lightsout traverse "<question>" --start <edge-or-node> [--connections <dir>] [--budget <n>] [--mode answer|doc|diagram|plan|bug] [--data <field>] [--cwd <path>]
  lightsout traverse --run <id> [--cwd <path>]        (resume a parked/budget-exhausted traversal)
  lightsout build-map <node...|all> [--connections <dir>] [--rescan] [--cwd <path>]
  lightsout build-map --author <run-id> [--connections <dir>] [--cwd <path>]   (post-review: write docs from a culled join.json)
  lightsout map-connection verify [<doc-id>...] [--repair] [--connections <dir>] [--cwd <path>]
  lightsout map-connection draft --run <traverse-run-id> [--connections <dir>] [--cwd <path>]
  lightsout plan explore "<request>" --name <n> [--areas <a,b>] [--cwd <path>]
  lightsout plan draft --name <n> [--scope single|phased] [--plans <dir>] [--cwd <path>]
  lightsout plan dedup --name <n> [--plans <dir>] [--cwd <path>]
  lightsout plan grade --name <n> [--plans <dir>] [--cwd <path>]
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

/** Tokens parseFlags didn't claim — mirrors its flag/value pairing exactly. */
const getPositionals = ({ args }: { args: string[] }) => {
	const positionals: string[] = [];

	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];

		if (token?.startsWith('--')) {
			if (args[index + 1] !== undefined && !args[index + 1]?.startsWith('--')) {
				index += 1;
			}

			continue;
		}

		if (token) {
			positionals.push(token);
		}
	}

	return positionals;
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

	if (command === 'implement') {
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

	if (command === 'doctor') {
		const checks = await runDoctor({ cwd });
		const icon = { pass: green('✓'), note: dim('ℹ'), warn: yellow('⚠'), fail: red('✗') };
		const counts = { pass: 0, note: 0, warn: 0, fail: 0 };

		console.log(`doctor    ${cwd}\n`);

		for (const check of checks) {
			counts[check.status] += 1;
			console.log(`${icon[check.status]} ${check.id.padEnd(16)}${check.detail}`);

			if (check.fix) {
				for (const line of check.fix.split('\n')) {
					console.log(dim(`  ${''.padEnd(16)}${line}`));
				}
			}
		}

		const tally = (Object.entries(counts) as Array<[string, number]>)
			.filter(([, count]) => count > 0)
			.map(([status, count]) => `${count} ${status}`)
			.join(' · ');

		console.log(`\n${checks.length} check(s) · ${tally}`);
		process.exit(counts.fail > 0 ? 1 : 0);
	}

	if (command === 'scan') {
		const scanPath = getStringFlag({ flags, name: 'path' });
		const { findings, notes } = await runScan({
			cwd,
			path: scanPath,
			all: flags.get('all') === true,
			writeBaseline: flags.get('baseline') === true,
			onProgress: (message) => console.log(dim(message)),
		});
		const bySeverity = { finding: findings.filter((entry) => entry.severity === 'finding'), advisory: findings.filter((entry) => entry.severity === 'advisory') };

		console.log('');

		for (const [severity, list] of Object.entries(bySeverity)) {
			for (const entry of list) {
				const icon = severity === 'finding' ? yellow('⚠') : dim('ℹ');
				const where = entry.files
					.map((file) => `${file.path}${file.startLine ? `:${file.startLine}${file.endLine && file.endLine !== file.startLine ? `-${file.endLine}` : ''}` : ''}`)
					.join(', ');

				console.log(`${icon} ${entry.detector.padEnd(20)}${entry.detail}`);
				console.log(dim(`  ${''.padEnd(20)}${where}`));
			}
		}

		for (const note of notes) {
			console.log(`${dim('ℹ')} ${'note'.padEnd(20)}${note}`);
		}

		const detectors = new Map<string, number>();

		for (const entry of findings) {
			detectors.set(entry.detector, (detectors.get(entry.detector) ?? 0) + 1);
		}

		const breakdown = [...detectors.entries()].map(([name, count]) => `${name} ${count}`).join(' · ');

		console.log(`\n${findings.length} finding(s)${findings.length > 0 ? ` · ${breakdown}` : ''} — report: .lightsout/scan.json`);
		process.exit(0);
	}

	if (command === 'traverse') {
		const question = getPositionals({ args: rest }).join(' ');
		const resumeRunId = getStringFlag({ flags, name: 'run' });
		const budgetFlag = getStringFlag({ flags, name: 'budget' });
		const modeFlag = getStringFlag({ flags, name: 'mode' });

		if (!question && !resumeRunId) {
			console.error(usage);
			process.exit(1);
		}

		// Traverse can run in a map-only repo with no lightsout.config.json —
		// fall back to the default driver and harness defaults.
		const config = await loadConfig({ cwd }).catch(() => undefined);
		const driver = getDriver({ name: config?.driver ?? 'claude-code' });

		try {
			const connections = await resolveConnectionsSource({
				cwd,
				source: getStringFlag({ flags, name: 'connections' }) ?? config?.traverse?.connections ?? '.lightsout/connections',
			});

			if (connections.remote) {
				console.log(dim(`map: ${connections.repo} → ${connections.dir}`));
			}

			const result = await runTraverse({
				cwd,
				driver,
				question: question || '(resumed)',
				connectionsDir: connections.dir,
				mode: modeFlag && Object.values(TraverseMode).includes(modeFlag as TraverseMode) ? (modeFlag as TraverseMode) : undefined,
				dataOfInterest: getStringFlag({ flags, name: 'data' }),
				start: getStringFlag({ flags, name: 'start' }),
				budget: budgetFlag ? Number.parseInt(budgetFlag, 10) : undefined,
				resumeRunId,
				model: config?.model,
				permissionMode: config?.permissionMode,
				onProgress: (message) => console.log(dim(message)),
			});
			const { state } = result;

			console.log(`\n${bold(`traverse ${result.runId}`)} — ${result.status}`);
			console.log(`${state.question}\n`);

			for (const [index, hop] of state.hops.entries()) {
				if (!hop.report) {
					console.log(`${dim(`${index + 1}.`)} ${hop.node} ${dim(`(${hop.note ?? 'non-repo node'})`)}`);
					continue;
				}

				console.log(`${dim(`${index + 1}.`)} ${bold(hop.node)} ${dim(`via ${hop.edge} · confidence ${hop.report.confidence}`)}`);
				console.log(`   ${hop.report.answerContribution}`);

				for (const transform of hop.report.transforms) {
					console.log(dim(`   · ${transform.at} — ${transform.what}`));
				}
			}

			if (state.gaps.length > 0) {
				console.log(`\n${yellow(`${state.gaps.length} gap(s)`)} — the map ends here; draft missing docs with map-connection:`);

				for (const gap of state.gaps) {
					console.log(`  ${gap.node}: ${gap.detail}${gap.exit ? ` (${gap.exit.kind} → ${gap.exit.target} at ${gap.exit.at})` : ''}`);
				}
			}

			if (state.drift.length > 0) {
				console.log(`\n${yellow(`${state.drift.length} drifted anchor(s)`)} — repair the connection docs:`);

				for (const drift of state.drift) {
					console.log(`  ${drift.edge} (${drift.node}): ${drift.status}${drift.foundAt ? ` — found at ${drift.foundAt}` : ''}`);
				}
			}

			// Non-answer modes render mechanically from the trace to a file.
			if (state.mode !== 'answer' && state.mode !== 'bug') {
				const edges = await readConnectionMap({ connectionsDir: connections.dir });
				const rendered = renderTrace({ state, edges, mode: state.mode });
				const outPath = join(result.runDir, `${state.mode}.md`);

				await writeFile(outPath, rendered, 'utf8');
				console.log(`\n${state.mode} rendered: ${outPath}`);
			}

			console.log(`\ntrace: ${result.runDir}/trace.json`);

			if (result.error) {
				console.error(`\n${result.error}`);
			}

			process.exit(result.status === 'complete' ? 0 : 1);
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	}

	if (command === 'build-map') {
		const authorRunId = getStringFlag({ flags, name: 'author' });
		const config = await loadConfig({ cwd }).catch(() => undefined);
		const connectionsSource = getStringFlag({ flags, name: 'connections' }) ?? config?.traverse?.connections ?? '.lightsout/connections';

		try {
			const connections = await resolveConnectionsSource({ cwd, source: connectionsSource });

			if (connections.remote) {
				console.log(dim(`map: ${connections.repo} → ${connections.dir}`));
			}

			if (authorRunId) {
				// Post-review author step: the user has culled join.json by hand.
				const joinPath = join(cwd, '.lightsout/traverse/map-runs', authorRunId, 'join.json');
				const reviewed = MapJoin.parse(JSON.parse(await readFile(joinPath, 'utf8')));
				const inventoriesDir = join(cwd, '.lightsout/traverse/inventories');
				const shaByNode = new Map<string, string>();

				for (const name of (await readdir(inventoriesDir).catch(() => [] as string[])).filter((entry) => entry.endsWith('.json'))) {
					const inventory = EdgeInventory.safeParse(JSON.parse(await readFile(join(inventoriesDir, name), 'utf8')));

					if (inventory.success) {
						shaByNode.set(inventory.data.node, inventory.data.scannedSha);
					}
				}

				const result = await authorConnectionDocs({
					connectionsDir: connections.dir,
					join: reviewed,
					shaByNode,
				});

				console.log(`${green('✓')} authored ${result.authored.length} doc(s)${result.authored.length > 0 ? `: ${result.authored.join(', ')}` : ''}`);
				console.log(`${green('✓')} confirmed ${result.confirmed} · repaired ${result.repaired} · INDEX.md regenerated (${result.edgeCount} edge(s))`);

				if (connections.remote) {
					console.log(`\nthe map is a clone of ${connections.repo} — commit & push (or open a PR) from ${connections.dir}`);
				}

				process.exit(0);
			}

			const nodeArgs = getPositionals({ args: rest });

			if (nodeArgs.length === 0) {
				console.error(usage);
				process.exit(1);
			}

			const driver = getDriver({ name: config?.driver ?? 'claude-code' });
			const result = await runBuildMap({
				cwd,
				driver,
				nodes: nodeArgs.length === 1 && nodeArgs[0] === 'all' ? 'all' : nodeArgs,
				connectionsDir: connections.dir,
				rescan: flags.get('rescan') === true,
				model: config?.model,
				permissionMode: config?.permissionMode,
				onProgress: (message) => console.log(dim(message)),
			});

			if (result.status !== 'complete' || !result.join) {
				console.error(`\n${result.error ?? 'build-map failed'}`);
				process.exit(1);
			}

			const { join: joined } = result;

			console.log(`\n${bold(`build-map ${result.runId}`)} — scanned ${result.scanned.length}, reused ${result.reused.length} inventory(ies)\n`);

			for (const edge of joined.matched) {
				console.log(`${green('＋')} ${edge.from} → ${edge.to} [${edge.kind}] ${edge.matchKey}${edge.fuzzy ? yellow(' (fuzzy — review hardest)') : ''}`);
				console.log(dim(`    ${edge.fromSighting.at} ↔ ${edge.toSighting.at}`));
			}

			for (const entry of joined.confirmed) {
				console.log(`${green('✓')} confirmed ${entry.doc}`);
			}

			for (const entry of joined.drifted) {
				console.log(`${yellow('~')} drifted ${entry.doc} (${entry.side} anchor → ${entry.foundAt})`);
			}

			for (const orphan of joined.orphansOut) {
				console.log(`${dim('?')} orphan out: ${orphan.node} [${orphan.kind}] ${orphan.matchKey} ${dim(`(${orphan.payload})`)}`);
			}

			for (const orphan of joined.orphansIn) {
				console.log(`${dim('?')} orphan in:  ${orphan.node} [${orphan.kind}] ${orphan.matchKey}`);
			}

			if (joined.noise.length > 0) {
				console.log(dim(`${joined.noise.length} noise sighting(s) (health/metrics/SaaS, intra-node self-loops) — excluded; see join.json`));
			}

			for (const gap of joined.gaps) {
				console.log(`${yellow('!')} scanner gap: ${gap.node} — ${gap.detail}`);
			}

			console.log(`\n${bold('REVIEW GATE')} — no docs written yet. Cull ${result.runDir}/join.json (delete rejected entries), then:`);
			console.log(`  lightsout build-map --author ${result.runId}${connectionsSource === '.lightsout/connections' ? '' : ` --connections ${connectionsSource}`}`);
			process.exit(0);
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	}

	if (command === 'map-connection') {
		const subcommand = getPositionals({ args: rest })[0];
		const mapConfig = await loadConfig({ cwd }).catch(() => undefined);
		const connectionsSource = getStringFlag({ flags, name: 'connections' }) ?? mapConfig?.traverse?.connections ?? '.lightsout/connections';

		try {
			const connections = await resolveConnectionsSource({ cwd, source: connectionsSource });

			if (connections.remote) {
				console.log(dim(`map: ${connections.repo} → ${connections.dir}`));
			}

			if (subcommand === 'verify') {
				const docIds = getPositionals({ args: rest }).slice(1);
				const results = await verifyConnectionAnchors({
					cwd,
					connectionsDir: connections.dir,
					docIds: docIds.length > 0 ? docIds : undefined,
					repair: flags.get('repair') === true,
					onProgress: (message) => console.log(dim(message)),
				});
				const icons: Record<string, string> = { current: dim('·'), ok: green('✓'), drifted: yellow('~'), missing: red('✗'), unverifiable: dim('?') };

				console.log('');

				for (const entry of results) {
					console.log(`${icons[entry.status]} ${entry.doc} ${dim(`${entry.side}/${entry.node}`)} ${entry.status}${entry.foundAt ? ` → ${entry.foundAt}` : ''}${entry.detail ? dim(` — ${entry.detail}`) : ''}`);
				}

				const broken = results.filter((entry) => entry.status === 'drifted' || entry.status === 'missing').length;

				console.log(
					`\n${results.length} anchor(s): ${results.filter((entry) => entry.status === 'current').length} current · ${results.filter((entry) => entry.status === 'ok').length} ok · ${broken} need attention${flags.get('repair') === true ? ' (drift repaired, sha advanced)' : broken > 0 ? ' — re-run with --repair to apply fixes' : ''}`,
				);

				if (connections.remote && flags.get('repair') === true) {
					console.log(`the map is a clone of ${connections.repo} — commit & push (or open a PR) from ${connections.dir}`);
				}

				process.exit(results.some((entry) => entry.status === 'missing') ? 1 : 0);
			}

			if (subcommand === 'draft') {
				const traverseRunId = getStringFlag({ flags, name: 'run' });

				if (!traverseRunId) {
					console.error(usage);
					process.exit(1);
				}

				const { drafted, draftsDir } = await draftConnectionDocs({ cwd, connectionsDir: connections.dir, traverseRunId });

				console.log(drafted.length === 0 ? 'no gaps with concrete exits in that trace — nothing to draft' : `${green('✓')} drafted ${drafted.length} scaffold(s) in ${draftsDir}:`);

				for (const id of drafted) {
					console.log(`  ${id} ${dim('— fill in the to-side, verify anchors, move up into the connections dir')}`);
				}

				process.exit(0);
			}

			console.error(usage);
			process.exit(1);
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	}

	if (command === 'plan') {
		const subcommand = getPositionals({ args: rest })[0];

		if (subcommand === 'explore') {
			const name = getStringFlag({ flags, name: 'name' });
			const request = getPositionals({ args: rest }).slice(1).join(' ');
			const areasFlag = getStringFlag({ flags, name: 'areas' });
			const areas = areasFlag
				? areasFlag
						.split(',')
						.map((area) => area.trim())
						.filter(Boolean)
				: undefined;

			if (!name || !request) {
				console.error(usage);
				process.exit(1);
			}

			// Planning can run before a lightsout.config.json exists — fall back
			// to the default driver and harness defaults.
			const config = await loadConfig({ cwd }).catch(() => undefined);
			const driver = getDriver({ name: config?.driver ?? 'claude-code' });

			const result = await runPlanExplore({
				cwd,
				driver,
				request,
				name,
				areas,
				model: config?.model,
				permissionMode: config?.permissionMode,
				onProgress: createProgressPrinter(),
			});

			if (result.status === 'paused-rate-limit') {
				console.error(`\n${result.error}`);
				process.exit(1);
			}

			if (result.status === 'failed' || !result.facts) {
				console.error(`\n${result.error ?? 'plan explore failed'}`);
				process.exit(1);
			}

			const { verification } = result.facts;

			console.log(`\n${bold(`plan explore ${name}`)} — ${result.facts.areas.length} area(s), verified ${result.facts.verifiedAt}`);
			console.log(`  paths:   ${verification.pathsChecked} checked · ${verification.missingPaths.length} missing`);
			console.log(`  scripts: ${verification.scriptsChecked} checked · ${verification.missingScripts.length} missing`);

			for (const missing of verification.missingPaths) {
				console.log(`${yellow('⚠')} path not found: ${missing}`);
			}

			for (const missing of verification.missingScripts) {
				console.log(`${yellow('⚠')} script not found: ${missing}`);
			}

			console.log(`\nfacts: ${result.factsPath}`);
			process.exit(0);
		}

		if (subcommand === 'draft' || subcommand === 'dedup' || subcommand === 'grade') {
			const name = getStringFlag({ flags, name: 'name' });

			if (!name) {
				console.error(usage);
				process.exit(1);
			}

			// Planning can run before a lightsout.config.json exists — fall back
			// to the default driver and harness defaults.
			const config = await loadConfig({ cwd }).catch(() => undefined);
			const driver = getDriver({ name: config?.driver ?? 'claude-code' });
			const plansDir = resolvePlansDir({ cwd, flag: getStringFlag({ flags, name: 'plans' }), config });

			// Standards are SUPPLEMENTAL for planning (load-if-configured,
			// non-fatal if absent) — resolved once and threaded into both draft
			// and grade, exactly the mechanism the implement pipeline uses.
			const packagesDir = config?.packagesDir ?? 'packages';
			const standardsPaths = config?.standards === false ? [] : (config?.standards ?? ['lightsout:code-defaults']);
			let standards: string | undefined;

			try {
				const channels = config?.standardsChannels ?? (await detectStandardsChannels({ cwd, packagesDir, packages: [] }));

				standards = await readStandards({ cwd, paths: standardsPaths, channels });
			} catch (error) {
				console.log(dim(`standards not loaded (non-fatal): ${error instanceof Error ? error.message : String(error)}`));
				standards = undefined;
			}

			if (subcommand === 'draft') {
				const scopeFlag = getStringFlag({ flags, name: 'scope' });
				const scope = scopeFlag === 'phased' ? PlanVariant.Overview : scopeFlag === 'single' ? PlanVariant.Single : undefined;
				const result = await runPlanDraft({
					cwd,
					driver,
					name,
					plansDir,
					scope,
					standards,
					model: config?.model,
					permissionMode: config?.permissionMode,
					onProgress: createProgressPrinter(),
				});

				if (result.status === 'paused-rate-limit' || result.status === 'failed') {
					console.error(`\n${result.error}`);
					process.exit(1);
				}

				if (result.status === 'facts-error') {
					console.error(`\n${red('facts error')} — the plan-writer found the facts/decisions do not match the codebase. Re-explore, then re-draft:`);

					for (const discrepancy of result.discrepancies) {
						console.error(`  ${yellow('⚠')} ${discrepancy}`);
					}

					process.exit(1);
				}

				if (result.status === 'structural-issues') {
					console.error(`\n${red(`${result.findings.length} structural issue(s)`)} remain after re-drafting — resolve, then re-draft:`);

					for (const finding of result.findings) {
						console.error(`  ${yellow('⚠')} [${finding.check}] ${finding.location} — ${finding.issue}`);
						console.error(dim(`     fix: ${finding.fix}`));
					}

					process.exit(1);
				}

				console.log(`\n${bold(`plan draft ${name}`)} — ${result.variant}, structurally clean`);

				for (const path of result.planPaths) {
					console.log(`  ${green('✓')} ${path}`);
				}

				process.exit(0);
			}

			if (subcommand === 'dedup') {
				const result = await runPlanDedup({
					cwd,
					driver,
					name,
					plansDir,
					standards,
					model: config?.model,
					permissionMode: config?.permissionMode,
					onProgress: createProgressPrinter(),
				});

				if (result.status === 'paused-rate-limit' || result.status === 'failed') {
					console.error(`\n${result.error}`);
					process.exit(1);
				}

				const { dedup } = result;
				const count = dedup.findings.length;

				console.log(
					`\n${bold(`plan dedup ${name}`)} — ${count > 0 ? yellow(`${count} duplication(s) to review`) : green('no duplication found')} (reviewed ${dedup.reviewedAt})`,
				);

				for (const finding of dedup.findings) {
					console.log(`${yellow('⧉')} ${finding.plannedSymbol} [${finding.recommendation}] collides with ${finding.collidesWith.map((collision) => collision.path).join(', ')}`);
					console.log(dim(`   ${finding.rationale}`));
				}

				console.log(`\ndedup: ${result.dedupPath}`);
				process.exit(0);
			}

			const result = await runPlanGrade({
				cwd,
				driver,
				name,
				plansDir,
				standards,
				model: config?.model,
				permissionMode: config?.permissionMode,
				onProgress: createProgressPrinter(),
			});

			if (result.status === 'paused-rate-limit' || result.status === 'failed') {
				console.error(`\n${result.error}`);
				process.exit(1);
			}

			const { grade } = result;

			console.log(`\n${bold(`plan grade ${name}`)} — ${grade.passed ? green(grade.grade) : red(grade.grade)} (graded ${grade.gradedAt})`);
			console.log(`  structural: ${grade.structural.length} · gaps: ${grade.gaps.length}`);

			for (const finding of grade.structural) {
				console.log(`${yellow('⚠')} [${finding.check}] ${finding.location} — ${finding.issue}`);
				console.log(dim(`   fix: ${finding.fix}`));
			}

			for (const gap of grade.gaps) {
				console.log(`${yellow('?')} [${gap.area}] ${gap.gap}`);
				console.log(dim(`   decide: ${gap.decision}${gap.options.length > 0 ? ` — options: ${gap.options.join(' / ')}` : ''}`));
			}

			console.log(`\ngrade: ${result.gradePath}`);
			process.exit(0);
		}

		console.error(usage);
		process.exit(1);
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
