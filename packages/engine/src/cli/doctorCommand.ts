import { dim } from '#src/cli/common/terminal/dim.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { red } from '#src/cli/common/terminal/red.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { runDoctor } from '#src/doctor/index.ts';

export const doctorCommand = async ({ cwd }: CommandContext): Promise<void> => {
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

	const tally = Object.entries(counts)
		.filter(([, count]) => count > 0)
		.map(([status, count]) => `${count} ${status}`)
		.join(' · ');

	console.log(`\n${checks.length} check(s) · ${tally}`);
	return exitCli({ code: counts.fail > 0 ? 1 : 0 });
};
