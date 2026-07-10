import { runVerify } from '@lightsout/engine';
import { VerifyVerdict } from '@lightsout/contracts';
import type { VerifyReport } from '@lightsout/contracts';
import { getStringFlag } from './common/args/getStringFlag';
import { printFinding } from './common/render/printFinding';
import { dim } from './common/terminal/dim';
import { red } from './common/terminal/red';
import { yellow } from './common/terminal/yellow';
import type { CommandContext } from './common/types/CommandContext';

export const verifyCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const base = getStringFlag({ flags, name: 'base' });
	const skipCoverage = flags.get('skip-coverage') === true;

	let report: VerifyReport;

	try {
		report = await runVerify({
			cwd,
			base,
			coverage: !skipCoverage,
			onProgress: (message) => console.log(dim(message)),
		});
	} catch (error) {
		// Missing config, not a git repo, or a bad --base ref — the environment
		// error exit code, distinct from a red verdict.
		console.error(red(error instanceof Error ? error.message : String(error)));
		process.exit(2);
	}

	console.log('');

	if (report.gatesError) {
		console.log(report.gatesError);
		console.log('');
	}

	for (const entry of report.findings) {
		printFinding({ entry });
	}

	for (const file of report.missingTests) {
		console.log(`${yellow('⚠')} ${'missing-tests'.padEnd(20)}${file}`);
		console.log(dim(`  ${''.padEnd(20)}new file, no co-located test file`));
	}

	for (const file of report.untestedChanges) {
		console.log(`${dim('ℹ')} ${'untested-change'.padEnd(20)}${file}`);
		console.log(dim(`  ${''.padEnd(20)}modified, no co-located test file — advisory`));
	}

	for (const note of report.notes) {
		console.log(`${dim('ℹ')} ${'note'.padEnd(20)}${note}`);
	}

	console.log(
		`\nverdict: ${report.verdict} · ${report.findings.length} finding(s) · ${report.missingTests.length} missing test(s) · ${report.untestedChanges.length} untested change(s) — report: .lightsout/verify.json`,
	);
	process.exit(report.verdict === VerifyVerdict.Red ? 1 : 0);
};
