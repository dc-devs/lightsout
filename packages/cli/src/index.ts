import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { RunStatus } from '@lightsout/contracts';
import { getDriver } from '@lightsout/drivers';
import { loadConfig, readRunManifest, runImplementPipeline, type PipelineResult } from '@lightsout/engine';

const usage = `lightsout — deterministic engine for coding agents

usage:
  lightsout run --plan <path> [--cwd <path>] [--skip-refactor]
  lightsout resume --run <id> [--cwd <path>] [--skip-refactor]
  lightsout status [--cwd <path>]
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

const printResult = ({ result }: { result: PipelineResult }) => {
	const { manifest, ok, error } = result;

	console.log(`\nrun ${manifest.runId}: ${manifest.status.toUpperCase()}`);

	for (const step of manifest.steps) {
		console.log(`  ${statusIcons[step.status] ?? '?'} ${step.id} (attempts: ${step.attempts})`);
	}

	if (manifest.changedFiles.length > 0) {
		console.log('  changed files:');

		for (const file of manifest.changedFiles) {
			console.log(`    - ${file}`);
		}
	}

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

		if (!planPath) {
			console.error(usage);
			process.exit(1);
		}

		const config = await loadConfig({ cwd });
		const driver = getDriver({ name: config.driver ?? 'claude-code' });

		console.log(`lightsout: starting run (plan: ${planPath}, driver: ${driver.name})`);

		const result = await runImplementPipeline({ cwd, planPath, driver, config, skipRefactor });

		printResult({ result });
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

		const result = await runImplementPipeline({ cwd, driver, config, existing: manifest, skipRefactor });

		printResult({ result });
		process.exit(result.ok ? 0 : 1);
	}

	if (command === 'status') {
		const runsDir = join(cwd, '.lightsout', 'runs');
		const runIds = await readdir(runsDir).catch(() => []);

		if (runIds.length === 0) {
			console.log('no runs found');
			process.exit(0);
		}

		for (const runId of runIds) {
			const manifest = await readRunManifest({ cwd, runId }).catch(() => undefined);

			if (manifest) {
				console.log(`${manifest.runId}  ${manifest.status}  plan: ${manifest.plan}  updated: ${manifest.updatedAt}`);
			}
		}

		process.exit(0);
	}

	console.error(usage);
	process.exit(command === undefined || command === 'help' ? 0 : 1);
};

await main();
