import type { RefactorBatch, StandardsFinding } from '@/contracts';

/**
 * Mechanical-first rule order: rules an agent can fix in place come
 * before judgment-heavier duplication work, so a run's early batches are its
 * safest. Rules absent from this list sort last, alphabetically — a rule a
 * standards package brings that this engine has never heard of degrades to
 * "after the known ones", never to an error.
 *
 * The ids are written out rather than imported, because batching order is
 * engine policy about how a refactor run is paced, not a fact about any rule —
 * a package declares which rules exist, and putting this ordering into the
 * package format would make every third-party package restate a preference it
 * has no stake in.
 */
const rulePriority: string[] = [
	// A path rule is a file move or a rename — the most mechanical fix there is,
	// so these lead.
	'path-banned-module-name',
	'path-common-flat',
	'path-common-barrel',
	'path-test-in-tests-folder',
	'path-test-not-colocated',
	'path-test-support-in-src',
	'module-boundary',
	'placement',
	'multi-export',
	'filename-mismatch',
	'test-mock-prefix',
	'test-mock-return-in-hook',
	'test-mock-untyped',
	'test-mock-wrapper-untyped',
	'test-shared-let',
	'test-assert-in-hook',
	'test-nested-describe',
	'test-manual-mock-cleanup',
	'test-strict-equal-matcher',
	'barrel-star',
	'barrel-dead-entry',
	'dead-export',
	'test-only-export',
	'barrel-only-export',
	'size-file',
	'size-function',
	'domain-graduation',
	'path-domain-folder-single-file',
	'path-folder-casing',
	'path-test-untested-subject-not-public',
	'test-multiple-setups',
	'test-mega-factory',
	'folder-census',
	'ast-duplicate',
	'clone',
	'name-duplicate',
	'name-synonym',
];

/** A batch above this many findings splits into sorted chunks — one agent job stays readable. */
const maxBatchFindings = 12;

const priorityOf = (rule: string) => {
	const index = rulePriority.indexOf(rule);

	return index === -1 ? rulePriority.length : index;
};

interface Params {
	/** Blocking-severity check results — the work. */
	blocking: StandardsFinding[];
	/** Advisory-severity results, every rule — attached to batches whose files overlap, never work on their own. */
	advisories: StandardsFinding[];
	/** Monorepo package parent dir, for the grouping folder. */
	packagesDir: string;
}

/**
 * Deterministic batching: one batch = one rule × one area of the repo —
 * a single coherent agent job. The area is `<packagesDir>/<package>` for
 * files under it, the top path segment otherwise, `(root)` for bare files.
 * Order is rule priority (mechanical-first) then folder; oversized
 * groups split into sorted chunks of at most 12 findings. Exported from the
 * module barrel deliberately: its ordering/cap edge cases are combinatorial
 * — the test standards' promotion signal — so it carries direct tests.
 */
export const batchFindings = ({ blocking, advisories, packagesDir }: Params): RefactorBatch[] => {
	const areaOf = (path: string) => {
		const segments = path.split('/');

		if (segments[0] === packagesDir && segments.length > 2 && segments[1]) {
			return `${packagesDir}/${segments[1]}`;
		}

		return segments.length > 1 && segments[0] ? segments[0] : '(root)';
	};

	// A finding spanning areas (a cross-package clone, say) can never be
	// resolved by an agent scoped to one side — it gets a dedicated cross
	// batch whose file set covers every side (live lesson: run 50d4ab35's
	// batch-03 correctly refused exactly this and escalated).
	const folderOf = (finding: StandardsFinding) => {
		const areas = new Set(finding.files.map((file) => areaOf(file.path)));

		return areas.size > 1 ? '(cross)' : ([...areas][0] ?? '(root)');
	};

	const groups = new Map<string, { rule: string; folder: string; findings: StandardsFinding[] }>();

	for (const finding of blocking) {
		const folder = folderOf(finding);
		const key = `${finding.rule}\0${folder}`;
		const group = groups.get(key) ?? { rule: finding.rule, folder, findings: [] };

		group.findings.push(finding);
		groups.set(key, group);
	}

	const crossLast = (folder: string) => (folder === '(cross)' ? 1 : 0);
	const ordered = [...groups.values()].sort(
		(a, b) =>
			priorityOf(a.rule) - priorityOf(b.rule) || a.rule.localeCompare(b.rule) || crossLast(a.folder) - crossLast(b.folder) || a.folder.localeCompare(b.folder),
	);

	const batches: RefactorBatch[] = [];

	for (const group of ordered) {
		const sorted = [...group.findings].sort((a, b) => a.siteKey.localeCompare(b.siteKey));

		for (let start = 0; start < sorted.length; start += maxBatchFindings) {
			const chunk = sorted.slice(start, start + maxBatchFindings);
			const chunkFiles = new Set(chunk.flatMap((finding) => finding.files.map((file) => file.path)));
			const number = String(batches.length + 1).padStart(2, '0');

			batches.push({
				id: `batch-${number}:${group.rule}:${group.folder}`,
				rule: group.rule,
				folder: group.folder,
				blocking: chunk,
				advisories: advisories.filter((advisory) => advisory.files.some((file) => chunkFiles.has(file.path))),
			});
		}
	}

	return batches;
};
