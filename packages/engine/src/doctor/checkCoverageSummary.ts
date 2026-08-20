import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultCoverageSummaryPath } from '#src/common/constants/defaultCoverageSummaryPath.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { DoctorCheck } from '#src/doctor/common/types/DoctorCheck.ts';
import type { PackageDir } from '#src/doctor/common/types/PackageDir.ts';

interface Params {
	config: LightsoutConfig;
	/** Root + scoped packages, as resolvePackageDirs returns them — each `dir` absolute. */
	packageDirs: PackageDir[];
}

/**
 * Confirm every scope that runs a coverage command writes a JSON summary where
 * `lightsout test-coverage-to-threshold` will look for it. Existence at the
 * configured path is the whole check — no tool config is parsed, so a repo can
 * measure with anything that writes the file.
 *
 * A missing summary is a warn rather than a fail: it is also the state of a
 * freshly cloned repo that has never run its coverage script.
 */
export const checkCoverageSummary = async ({ config, packageDirs }: Params): Promise<DoctorCheck | undefined> => {
	const scoped = config['package-gates']?.['test-coverage'];
	const rootApplies = typeof config.gates['test-coverage'] === 'string';

	if (!scoped && !rootApplies) {
		return undefined;
	}

	const summaryPath = config['coverage-summary-path'] ?? defaultCoverageSummaryPath;
	// Measurement follows the same packages-only rule the coverage run does: a
	// scoped command means the packages ARE the measurement.
	const scopes = scoped ? packageDirs.filter((entry) => entry.label !== 'root') : packageDirs.filter((entry) => entry.label === 'root');
	const expected = scopes.map((entry) => ({ label: entry.label, path: join(entry.dir, summaryPath) }));
	const absent: string[] = [];

	for (const entry of expected) {
		await stat(entry.path).catch(() => absent.push(`${entry.label}: ${summaryPath}`));
	}

	return absent.length === 0
		? { id: 'coverage-summary', status: 'pass', detail: `coverage summary found for ${expected.length} scope(s)` }
		: {
				id: 'coverage-summary',
				status: 'warn',
				detail: `not found: ${absent.join(', ')}`,
				fix: `configure a json-summary coverage reporter (jest: coverageReporters ['json-summary']) writing ${summaryPath}, run the coverage script once, or set coverage-summary-path`,
			};
};
