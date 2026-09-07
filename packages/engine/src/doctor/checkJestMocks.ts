import { readFile } from 'node:fs/promises';
import type { DoctorCheck } from '#src/doctor/common/types/DoctorCheck.ts';
import type { PackageDir } from '#src/doctor/common/types/PackageDir.ts';
import { findJestConfigs } from '#src/doctor/common/utils/findJestConfigs.ts';

interface Params {
	cwd: string;
	packageDirs: PackageDir[];
}

/**
 * The test standards' Mock Cleanup section assumes clearMocks/restoreMocks in
 * Jest config; agents are forbidden from adding them mid-run (repo-wide
 * behavior change), so the doctor is where the gap gets surfaced.
 */
export const checkJestMocks = async ({ cwd, packageDirs }: Params): Promise<DoctorCheck | undefined> => {
	const jestFindings: string[] = [];
	let jestConfigCount = 0;

	for (const { label, dir } of packageDirs) {
		for (const configPath of await findJestConfigs({ packageDir: dir })) {
			jestConfigCount += 1;

			const text = await readFile(configPath, 'utf8').catch(() => '');
			const absent = ['clearMocks', 'restoreMocks'].filter((flag) => !new RegExp(`${flag}\\s*:\\s*true`).test(text));

			if (absent.length > 0) {
				jestFindings.push(`${label}: ${configPath.slice(cwd.length + 1)} lacks ${absent.join(', ')}`);
			}
		}
	}

	if (jestConfigCount === 0) {
		return undefined;
	}

	return jestFindings.length === 0
		? { id: 'jest-mocks', status: 'pass', detail: 'all Jest configs set clearMocks + restoreMocks' }
		: {
				id: 'jest-mocks',
				status: 'warn',
				detail: jestFindings.join('; '),
				fix: 'add clearMocks: true, restoreMocks: true — then run that package’s FULL test suite: tests relying on import-time or beforeAll mock calls will break and need rework (see test standards, Mock Cleanup)',
			};
};
