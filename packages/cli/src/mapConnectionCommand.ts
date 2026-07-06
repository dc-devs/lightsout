import { draftConnectionDocs, loadConfig, verifyConnectionAnchors } from '@lightsout/engine';
import { getPositionals } from './common/args/getPositionals';
import { getStringFlag } from './common/args/getStringFlag';
import { usage } from './common/constants/usage';
import { dim } from './common/terminal/dim';
import { green } from './common/terminal/green';
import { red } from './common/terminal/red';
import { yellow } from './common/terminal/yellow';
import type { CommandContext } from './common/types/CommandContext';
import { resolveCommandConnections } from './common/utils/resolveCommandConnections';

export const mapConnectionCommand = async ({ flags, rest, cwd }: CommandContext): Promise<void> => {
	const subcommand = getPositionals({ args: rest })[0];
	const mapConfig = await loadConfig({ cwd }).catch(() => undefined);

	try {
		const { connections } = await resolveCommandConnections({ cwd, flags, config: mapConfig });

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
};
