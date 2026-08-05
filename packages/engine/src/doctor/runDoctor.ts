import type { LightsoutConfig } from '@lightsout/contracts';
import { loadConfig } from '../common/utils/loadConfig';
import { checkGenerated } from './checkGenerated';
import { checkGitignore } from './checkGitignore';
import { checkHarness } from './checkHarness';
import { checkJestMocks } from './checkJestMocks';
import { checkLintRules } from './checkLintRules';
import { checkScriptBinaries } from './checkScriptBinaries';
import { checkUserEvent } from './checkUserEvent';
import type { DoctorCheck } from './common/types/DoctorCheck';
import { resolvePackageDirs } from './resolvePackageDirs';

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
 * paths, script binaries. Each warn/fail carries the exact fix; the doctor
 * NEVER mutates — repo-wide changes (e.g. `clearMocks: true`) are a human's
 * decision to apply and verify.
 */
export const runDoctor = async ({ cwd, probeHarness }: Params): Promise<DoctorCheck[]> => {
	const checks: DoctorCheck[] = [];

	let config: LightsoutConfig;

	try {
		config = await loadConfig({ cwd });
	} catch (error) {
		return [
			{
				id: 'config',
				status: 'fail',
				detail: error instanceof Error ? error.message : String(error),
				fix: 'create or repair lightsout.config.json — every other check depends on it',
			},
		];
	}

	const packagesDir = config.packagesDir ?? 'packages';

	checks.push({
		id: 'config',
		status: 'pass',
		detail: `lightsout.config.json valid · harness ${config.harness ?? 'claude-code'}${config.packageScripts ? ` · monorepo (${packagesDir}/)` : ''}`,
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

	checks.push(await checkScriptBinaries({ cwd, config }));

	// Positives first, actionable items last (nearest the prompt) — stable
	// within each severity, so related checks keep their relative order.
	return checks.sort((a, b) => severityRank[a.status] - severityRank[b.status]);
};
