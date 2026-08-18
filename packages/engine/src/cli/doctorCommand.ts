import { dim } from '@/cli/common/terminal/dim';
import { green } from '@/cli/common/terminal/green';
import { red } from '@/cli/common/terminal/red';
import { yellow } from '@/cli/common/terminal/yellow';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { exitCli } from '@/cli/common/utils/exitCli';
import { runDoctor } from '@/doctor';

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

	const tally = (Object.entries(counts) as Array<[string, number]>)
		.filter(([, count]) => count > 0)
		.map(([status, count]) => `${count} ${status}`)
		.join(' · ');

	console.log(`\n${checks.length} check(s) · ${tally}`);
	return exitCli({ code: counts.fail > 0 ? 1 : 0 });
};
