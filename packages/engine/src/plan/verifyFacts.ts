import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExploreReport, PathVerification } from '@lightsout/contracts';

interface Params {
	cwd: string;
	report: ExploreReport;
}

const scriptKeysOf = (raw: string): Set<string> => {
	try {
		const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };

		return new Set(parsed.scripts && typeof parsed.scripts === 'object' ? Object.keys(parsed.scripts) : []);
	} catch {
		return new Set();
	}
};

/**
 * Deterministically re-check an explorer's claims on disk — no agent. Every
 * `filesToModify`/`patternsToMirror` path is `stat`ed; every area script key is
 * looked up in that area's affected packages' package.json plus the repo-root
 * package.json (a miss only when absent from all). An agent claiming a path
 * exists is not evidence; this is. Never throws — the result is data.
 */
export const verifyFacts = async ({ cwd, report }: Params): Promise<PathVerification> => {
	const paths = report.areas.flatMap((area) => [...area.filesToModify.map((file) => file.path), ...area.patternsToMirror.map((pattern) => pattern.path)]);
	const missingPaths: string[] = [];

	for (const path of paths) {
		const exists = await stat(join(cwd, path)).then(
			() => true,
			() => false,
		);

		if (!exists) {
			missingPaths.push(path);
		}
	}

	const missingScripts: string[] = [];
	let scriptsChecked = 0;

	for (const area of report.areas) {
		if (area.scripts.length === 0) {
			continue;
		}

		const manifestPaths = [join(cwd, 'package.json'), ...area.affectedPackages.map((pkg) => join(cwd, pkg, 'package.json'))];
		const available = new Set<string>();

		for (const manifestPath of manifestPaths) {
			const raw = await readFile(manifestPath, 'utf8').catch(() => undefined);

			if (raw) {
				for (const key of scriptKeysOf(raw)) {
					available.add(key);
				}
			}
		}

		for (const script of area.scripts) {
			scriptsChecked += 1;

			if (!available.has(script.key)) {
				missingScripts.push(script.key);
			}
		}
	}

	return {
		pathsChecked: paths.length,
		missingPaths,
		scriptsChecked,
		missingScripts,
		// Explore returns only modify/mirror paths; create-path checking is a
		// draft-phase concern. Defined here for Phase 2 reuse; empty for now.
		createPathsThatExist: [],
	};
};
