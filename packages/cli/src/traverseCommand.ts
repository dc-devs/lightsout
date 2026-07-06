import { runTraverse } from '@lightsout/engine';
import { getPositionals } from './common/args/getPositionals';
import { getStringFlag } from './common/args/getStringFlag';
import { usage } from './common/constants/usage';
import { bold } from './common/terminal/bold';
import { dim } from './common/terminal/dim';
import { yellow } from './common/terminal/yellow';
import type { CommandContext } from './common/types/CommandContext';
import { resolveCommandConnections } from './common/utils/resolveCommandConnections';
import { resolveConfigAndDriver } from './common/utils/resolveConfigAndDriver';

const renderHops = ({ hops }: { hops: Awaited<ReturnType<typeof runTraverse>>['state']['hops'] }) => {
	for (const [index, hop] of hops.entries()) {
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
};

export const traverseCommand = async ({ flags, rest, cwd }: CommandContext): Promise<void> => {
	const question = getPositionals({ args: rest }).join(' ');
	const resumeRunId = getStringFlag({ flags, name: 'run' });
	const budgetFlag = getStringFlag({ flags, name: 'budget' });

	if (!question && !resumeRunId) {
		console.error(usage);
		process.exit(1);
	}

	const { config, driver } = await resolveConfigAndDriver({ cwd });

	try {
		const { connections } = await resolveCommandConnections({ cwd, flags, config });

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

		renderHops({ hops: state.hops });

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
};
