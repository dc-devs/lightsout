import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DoctorCheck } from '#src/doctor/common/types/DoctorCheck.ts';

interface Params {
	cwd: string;
	/** The config key the paths came from, which is also the check's id. */
	id: 'generated' | 'vendored';
	/** The configured prefixes, or nothing when the key is absent. */
	paths?: string[];
	/** The exact change that clears a warn — a stale generated path and a stale vendored one are fixed differently. */
	fix: string;
}

/**
 * Confirm every path a config key excludes from the source walk still exists.
 *
 * A missing entry is worth saying out loud whichever key it came from: it is
 * either stale, or the thing it names was never produced. Silence would be the
 * worse answer, because an exclusion that matches nothing hides no files and
 * so fails invisibly.
 *
 * One function for both keys rather than one apiece. The audit is identical —
 * only the id and the fix sentence differ — and a second copy is where the two
 * would drift.
 */
export const checkConfiguredPaths = async ({ cwd, id, paths, fix }: Params): Promise<DoctorCheck | undefined> => {
	if (!paths) {
		return undefined;
	}

	const absent: string[] = [];

	for (const prefix of paths) {
		await stat(join(cwd, prefix)).catch(() => absent.push(prefix));
	}

	return absent.length === 0
		? { id, status: 'pass', detail: `${paths.length} ${id} path(s) exist` }
		: { id, status: 'warn', detail: `not found: ${absent.join(', ')}`, fix };
};
