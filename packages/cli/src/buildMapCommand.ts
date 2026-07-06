import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { EdgeInventory, MapJoin } from '@lightsout/contracts';
import { getDriver } from '@lightsout/drivers';
import { authorConnectionDocs, loadConfig, resolveConnectionsSource, runBuildMap } from '@lightsout/engine';
import { getPositionals } from './common/args/getPositionals';
import { getStringFlag } from './common/args/getStringFlag';
import { usage } from './common/constants/usage';
import { bold } from './common/terminal/bold';
import { dim } from './common/terminal/dim';
import { green } from './common/terminal/green';
import { yellow } from './common/terminal/yellow';
import type { CommandContext } from './common/types/CommandContext';

const renderJoin = ({ joined }: { joined: NonNullable<Awaited<ReturnType<typeof runBuildMap>>['join']> }) => {
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
};

export const buildMapCommand = async ({ flags, rest, cwd }: CommandContext): Promise<void> => {
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

		renderJoin({ joined });

		console.log(`\n${bold('REVIEW GATE')} — no docs written yet. Cull ${result.runDir}/join.json (delete rejected entries), then:`);
		console.log(`  lightsout build-map --author ${result.runId}${connectionsSource === '.lightsout/connections' ? '' : ` --connections ${connectionsSource}`}`);
		process.exit(0);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
};
