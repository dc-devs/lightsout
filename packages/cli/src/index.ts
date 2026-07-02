import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, readRunManifest, runImplementPipeline } from '@lightsout/engine';
import { createClaudeCodeDriver } from '@lightsout/drivers';

const usage = `lightsout — deterministic engine for coding agents

usage:
  lightsout run --plan <path> [--cwd <path>]
  lightsout status [--cwd <path>]
  lightsout resume --run <id>   (v0.2)
`;

const parseFlags = ({ args }: { args: string[] }) => {
	const flags = new Map<string, string>();

	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		const value = args[index + 1];

		if (key?.startsWith('--') && value !== undefined) {
			flags.set(key.slice(2), value);
		}
	}

	return flags;
};

const printResult = ({ ok, manifest, error }: { ok: boolean; manifest: { runId: string; status: string; steps: { id: string; status: string; attempts: number }[]; changedFiles: string[] }; error?: string }) => {
	console.log(`\nrun ${manifest.runId}: ${manifest.status.toUpperCase()}`);

	for (const step of manifest.steps) {
		console.log(`  ${step.status === 'passed' ? '✓' : '✗'} ${step.id} (attempts: ${step.attempts})`);
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
	const cwd = flags.get('cwd') ?? process.cwd();

	if (command === 'run') {
		const planPath = flags.get('plan');

		if (!planPath) {
			console.error(usage);
			process.exit(1);
		}

		const config = await loadConfig({ cwd });
		const driver = createClaudeCodeDriver();

		console.log(`lightsout: starting run (plan: ${planPath}, driver: ${driver.name})`);

		const result = await runImplementPipeline({ cwd, planPath, driver, config });

		printResult(result);
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

	if (command === 'resume') {
		console.error('resume: not implemented yet (v0.2) — run state is preserved in .lightsout/runs/');
		process.exit(1);
	}

	console.error(usage);
	process.exit(command === undefined || command === 'help' ? 0 : 1);
};

await main();
