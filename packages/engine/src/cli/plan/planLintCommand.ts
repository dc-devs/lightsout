import { getRequiredFlag } from '@/cli/common/args/getRequiredFlag';
import { printStructuralFinding } from '@/cli/common/render/printStructuralFinding';
import { bold } from '@/cli/common/terminal/bold';
import { green } from '@/cli/common/terminal/green';
import { red } from '@/cli/common/terminal/red';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { createProgressPrinter } from '@/cli/common/utils/createProgressPrinter';
import { runPlanLint } from '@/plan';

export const planLintCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = getRequiredFlag({ flags, name: 'name' });
	const result = await runPlanLint({ cwd, name, onProgress: createProgressPrinter() });

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
