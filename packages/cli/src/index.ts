import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EdgeInventory, MapJoin, PlanVariant, RunStatus } from '@lightsout/contracts';
import { getDriver } from '@lightsout/drivers';
import {
	authorConnectionDocs,
	detectStandardsChannels,
	draftConnectionDocs,
	isPidAlive,
	loadConfig,
	readFriction,
	readRunLock,
	readRunManifest,
	readStandards,
	resolvePlansDir,
	runBuildMap,
	runDoctor,
	runPlanDedup,
	runPlanDraft,
	runPlanExplore,
	runPlanGrade,
	runScan,
	runPromptImprovement,
	runTraverse,
	runDebug,
	resolveConnectionsSource,
	verifyConnectionAnchors,
} from '@lightsout/engine';
import { getPositionals } from './common/args/getPositionals';
import { getStringFlag } from './common/args/getStringFlag';
import { parseFlags } from './common/args/parseFlags';
import { usage } from './common/constants/usage';
import { printResult } from './common/render/printResult';
import { printRunHeader } from './common/render/printRunHeader';
import { bold } from './common/terminal/bold';
import { dim } from './common/terminal/dim';
import { green } from './common/terminal/green';
import { red } from './common/terminal/red';
import { yellow } from './common/terminal/yellow';
import { createProgressPrinter } from './common/utils/createProgressPrinter';
import { runPipelineOrFailFast } from './common/utils/runPipelineOrFailFast';

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

	if (command === 'debug') {
		const symptoms = getPositionals({ args: rest }).join(' ');
		const resumeRunId = getStringFlag({ flags, name: 'run' });
		const budgetFlag = getStringFlag({ flags, name: 'budget' });

		if (!symptoms && !resumeRunId) {
			console.error(usage);
			process.exit(1);
		}

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

			const result = await runDebug({
				cwd,
				driver,
				symptoms: symptoms || '(resumed)',
				connectionsDir: connections.dir,
				start: getStringFlag({ flags, name: 'start' }),
				at: getStringFlag({ flags, name: 'at' }),
				suspectCommit: getStringFlag({ flags, name: 'suspect' }),
				budget: budgetFlag ? Number.parseInt(budgetFlag, 10) : undefined,
				resumeRunId,
				model: config?.model,
				permissionMode: config?.permissionMode,
				onProgress: (message) => console.log(dim(message)),
			});
			const { state } = result;

			console.log(`\n${bold(`debug ${result.runId}`)} — ${result.status}`);
			console.log(`${state.symptoms}\n`);

			for (const [index, hop] of state.hops.entries()) {
				if (!hop.report) {
					console.log(`${dim(`${index + 1}.`)} ${hop.node} ${dim(`(${hop.note ?? 'non-repo node'})`)}`);
					continue;
				}

				const paintVerdict = hop.report.verdict === 'root-cause' ? green : hop.report.verdict === 'stuck' ? yellow : dim;

				console.log(`${dim(`${index + 1}.`)} ${bold(hop.node)} ${dim(`(${hop.direction})`)} — ${paintVerdict(hop.report.verdict)}`);
				console.log(`   ${hop.report.investigation}`);

				if (hop.report.nextLead) {
					console.log(dim(`   ↳ ${hop.report.nextLead.direction} via ${hop.report.nextLead.kind} ${hop.report.nextLead.target} — ${hop.report.nextLead.why}`));
				}
			}

			if (state.resolution) {
				console.log(`\n${green('root cause')} — ${bold(state.resolution.node)} at ${state.resolution.at}`);
				console.log(`  ${state.resolution.explanation}`);
				console.log(`\n${green('proposed fix')}: ${state.resolution.proposedFix}`);
			}

			if (state.gaps.length > 0) {
				console.log(`\n${yellow(`${state.gaps.length} gap(s)`)} — where the trail stopped (unmapped boundary → build-map or author the doc; contradiction/unobservable → inspect by hand):`);

				for (const gap of state.gaps) {
					console.log(`  ${gap.node}: ${gap.detail}`);
				}
			}

			if (state.drift.length > 0) {
				console.log(`\n${yellow(`${state.drift.length} drifted anchor(s)`)} — repair the connection docs:`);

				for (const drift of state.drift) {
					console.log(`  ${drift.node}${drift.viaEdge ? ` (${drift.viaEdge})` : ''}: ${drift.status}${drift.foundAt ? ` — found at ${drift.foundAt}` : ''}`);
				}
			}

			console.log(`\ntrace: ${result.runDir}/trace.json`);

			if (result.error) {
				console.error(`\n${result.error}`);
			}

			process.exit(result.status === 'resolved' ? 0 : 1);
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
