import { join } from 'node:path';
import { getDriver } from '@lightsout/drivers';
import { loadConfig, resolveConnectionsSource, runDebug } from '@lightsout/engine';
import { getPositionals } from './common/args/getPositionals';
import { getStringFlag } from './common/args/getStringFlag';
import { usage } from './common/constants/usage';
import { bold } from './common/terminal/bold';
import { dim } from './common/terminal/dim';
import { green } from './common/terminal/green';
import { yellow } from './common/terminal/yellow';
import type { CommandContext } from './common/types/CommandContext';

const renderHops = ({ hops }: { hops: Awaited<ReturnType<typeof runDebug>>['state']['hops'] }) => {
	for (const [index, hop] of hops.entries()) {
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
};

export const debugCommand = async ({ flags, rest, cwd }: CommandContext): Promise<void> => {
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

		renderHops({ hops: state.hops });

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
};
