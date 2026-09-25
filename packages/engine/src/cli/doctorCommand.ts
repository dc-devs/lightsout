import { usage } from '#src/cli/common/constants/usage.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { red } from '#src/cli/common/terminal/red.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import { runDoctor } from '#src/doctor/runDoctor.ts';

/**
 * The line a reader gets before a single cent of theirs is spent.
 *
 * The harness name is the part that carries meaning — it is the binary about to
 * be shelled and the subscription about to be billed — so it is read from the
 * config rather than described in general terms. A config that does not parse
 * is not this line's problem: the doctor's own `config` check reports it one
 * line later, and a stack trace here would replace that report.
 */
const warnBeforeProbing = async ({ cwd }: { cwd: string }) => {
	const config = await readOptionalConfig({ cwd }).catch(() => undefined);

	console.log(`--usage-probe: about to spend one real agent call on ${config?.harness ?? 'claude-code'} — it bills your own subscription.`);
};

/**
 * `lightsout doctor` — the read-only audit of a repo's install, one icon line
 * per check with its fix indented beneath it.
 *
 * `--usage-probe` adds the one check that is not free: a single throwaway agent
 * call against the configured harness, confirming that harness's token fields
 * still reach the engine. It is boolean, so a value-carrying form is a usage
 * error rather than a differently-shaped request, and it is off unless asked
 * for — a plain `doctor` spawns no agent and spends nothing.
 */
export const doctorCommand = async ({ cwd, flags }: CommandContext): Promise<void> => {
	const usageProbe = flags.has('usage-probe');

	if (usageProbe && flags.get('usage-probe') !== true) {
		console.error(usage);
		return exitCli({ code: 1 });
	}

	if (usageProbe) {
		await warnBeforeProbing({ cwd });
	}

	const checks = await runDoctor({ cwd, usageProbe });
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
