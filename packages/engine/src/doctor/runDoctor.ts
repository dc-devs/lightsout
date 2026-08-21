import { readConfig } from '#src/common/config/readConfig.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { checkCoverageSummary } from '#src/doctor/checkCoverageSummary.ts';
import { checkGenerated } from '#src/doctor/checkGenerated.ts';
import { checkGitignore } from '#src/doctor/checkGitignore.ts';
import { checkHarness } from '#src/doctor/checkHarness.ts';
import { checkJestMocks } from '#src/doctor/checkJestMocks.ts';
import { checkLintRules } from '#src/doctor/checkLintRules.ts';
import { checkScriptBinaries } from '#src/doctor/checkScriptBinaries.ts';
import { checkUserEvent } from '#src/doctor/checkUserEvent.ts';
import type { DoctorCheck } from '#src/doctor/common/types/DoctorCheck.ts';
import { resolvePackageDirs } from '#src/doctor/resolvePackageDirs.ts';

const severityRank: Record<DoctorCheck['status'], number> = { pass: 0, note: 1, warn: 2, fail: 3 };

interface Params {
	cwd: string;
	/** Test seam for the harness binary probe — defaults to running `<binary> --version`. */
	probeHarness?: (params: { binary: string }) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

/**
 * Read-only audit of a consumer repo against every assumption the engine and
 * the bundled standards make: config validity, harness binary, gitignore run
 * state, scoped-gate script coverage, Jest mock-cleanup config, generated
 * paths, coverage summary reporting, script binaries. Each warn/fail carries
 * the exact fix; the doctor NEVER mutates — repo-wide changes (e.g.
 * `clearMocks: true`) are a human's decision to apply and verify.
 */
export const runDoctor = async ({ cwd, probeHarness }: Params): Promise<DoctorCheck[]> => {
	const checks: DoctorCheck[] = [];

	let config: LightsoutConfig;

	try {
		config = await readConfig({ cwd });
	} catch (error) {
		return [
			{
				id: 'config',
				status: 'fail',
				detail: messageOf({ error }),
				fix: 'create or repair lightsout.config.json — every other check depends on it',
			},
		];
	}

	const packagesDir = config['packages-dir'] ?? defaultPackagesDir;

	checks.push({
		id: 'config',
		status: 'pass',
		detail: `lightsout.config.json valid · harness ${config.harness ?? 'claude-code'}${config['package-gates'] ? ` · monorepo (${packagesDir}/)` : ''}`,
	});

	checks.push(await checkHarness({ cwd, config, probeHarness }));
	checks.push(await checkGitignore({ cwd }));

	// packageDirs (root + every scoped package) is resolved once here and fed
	// to every package-iterating check below.
	const { packageDirs, scopedGatesCheck } = await resolvePackageDirs({ cwd, config, packagesDir });

	if (scopedGatesCheck) {
		checks.push(scopedGatesCheck);
	}

	const jestMocks = await checkJestMocks({ cwd, packageDirs });

	if (jestMocks) {
		checks.push(jestMocks);
	}

	const userEvent = await checkUserEvent({ packageDirs });

	if (userEvent) {
		checks.push(userEvent);
	}

	const lintRules = await checkLintRules({ config, packageDirs });

	if (lintRules) {
		checks.push(lintRules);
	}

	const generated = await checkGenerated({ cwd, config });

	if (generated) {
		checks.push(generated);
	}

	const coverageSummary = await checkCoverageSummary({ config, packageDirs });

	if (coverageSummary) {
		checks.push(coverageSummary);
	}

	checks.push(await checkScriptBinaries({ cwd, config }));

	// Positives first, actionable items last (nearest the prompt) — stable
	// within each severity, so related checks keep their relative order.
	return checks.sort((a, b) => severityRank[a.status] - severityRank[b.status]);
};
