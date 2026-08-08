import { StandardsRule, type RefactorBatch, type StandardsFinding } from '@/contracts';

/**
 * Mechanical-first rule order: rules an agent can fix in place come
 * before judgment-heavier duplication work, so a run's early batches are its
 * safest. Rules absent from this list sort last, alphabetically —
 * a new rule degrades to "after the known ones", never to an error. The
 * entries are the rule constants rather than their id strings, so a renamed
 * rule fails to compile here instead of silently sorting itself last.
 */
const rulePriority: StandardsRule[] = [
	// A path rule is a file move or a rename — the most mechanical fix there is,
	// so these lead.
	StandardsRule.PathBannedModuleName,
	StandardsRule.PathCommonFlat,
	StandardsRule.PathCommonBarrel,
	StandardsRule.PathTestInTestsFolder,
	StandardsRule.PathTestNotColocated,
	StandardsRule.PathTestSupportInSrc,
	StandardsRule.ModuleBoundary,
	StandardsRule.Placement,
	StandardsRule.MultiExport,
	StandardsRule.FilenameMismatch,
	StandardsRule.TestMockPrefix,
	StandardsRule.TestMockReturnInHook,
	StandardsRule.TestMockUntyped,
	StandardsRule.TestMockWrapperUntyped,
	StandardsRule.TestSharedLet,
	StandardsRule.TestAssertInHook,
	StandardsRule.TestNestedDescribe,
	StandardsRule.TestManualMockCleanup,
	StandardsRule.TestStrictEqualMatcher,
	StandardsRule.BarrelStar,
	StandardsRule.BarrelDeadEntry,
	StandardsRule.DeadExport,
	StandardsRule.TestOnlyExport,
	StandardsRule.BarrelOnlyExport,
	StandardsRule.SizeFile,
	StandardsRule.SizeFunction,
	StandardsRule.DomainGraduation,
	StandardsRule.PathDomainFolderSingleFile,
	StandardsRule.PathFolderCasing,
	StandardsRule.PathTestUntestedSubjectNotPublic,
	StandardsRule.TestMultipleSetups,
	StandardsRule.TestMegaFactory,
	StandardsRule.FolderCensus,
	StandardsRule.AstDuplicate,
	StandardsRule.Clone,
	StandardsRule.NameDuplicate,
	StandardsRule.NameSynonym,
];

/** A batch above this many findings splits into sorted chunks — one agent job stays readable. */
const maxBatchFindings = 12;

const priorityOf = (rule: StandardsRule) => {
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

		return areas.size > 1 ? '(cross)' : [...areas][0] ?? '(root)';
	};

	const groups = new Map<string, { rule: StandardsRule; folder: string; findings: StandardsFinding[] }>();

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
			priorityOf(a.rule) - priorityOf(b.rule) ||
			a.rule.localeCompare(b.rule) ||
			crossLast(a.folder) - crossLast(b.folder) ||
			a.folder.localeCompare(b.folder),
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
