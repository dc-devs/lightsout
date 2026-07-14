import { loadConfig, resolvePlansDir, runPlanLint } from '@lightsout/engine';
import { getRequiredFlag } from '../common/args/getRequiredFlag';
import { getStringFlag } from '../common/args/getStringFlag';
import { printStructuralFinding } from '../common/render/printStructuralFinding';
import { bold } from '../common/terminal/bold';
import { green } from '../common/terminal/green';
import { red } from '../common/terminal/red';
import type { CommandContext } from '../common/types/CommandContext';
import { createProgressPrinter } from '../common/utils/createProgressPrinter';

export const planLintCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = getRequiredFlag({ flags, name: 'name' });
	const config = await loadConfig({ cwd }).catch(() => undefined);
	const plansDir = resolvePlansDir({ cwd, flag: getStringFlag({ flags, name: 'plans' }), config });
	const result = await runPlanLint({ cwd, name, plansDir, onProgress: createProgressPrinter() });

	if (result.status === 'failed') {
		console.error(`\n${result.error}`);
		process.exit(1);
	}

	const { findings, planPaths } = result;

	console.log(
		`\n${bold(`plan lint ${name}`)} — ${findings.length === 0 ? green('clean') : red(`${findings.length} structural finding(s)`)} (${planPaths.length} file(s))`,
	);

	for (const finding of findings) {
		printStructuralFinding({ finding });
	}

	// Findings print either way; the exit code is the signal the writer's
	// self-lint loop and humans both read.
	process.exit(findings.length > 0 ? 1 : 0);
};
