import type { StandardsPass } from '@/standardsCheck/common/types/StandardsPass';
import { checkFolderRules } from '@/standardsCheck/common/utils/checkFolderRules';
import { checkTestPathRules } from '@/standardsCheck/common/utils/checkTestPathRules';
import { readFrameworkCarveOuts } from '@/standardsCheck/common/utils/readFrameworkCarveOuts';
import { mapFolderModules } from '@/standardsCheck/mapFolderModules';

/**
 * Where things sit and what they are called, against folder-structure.md,
 * module-api.md, file-naming.md and the location half of unit-testing.md.
 *
 * Decided entirely from the file list plus two pieces of structured metadata —
 * each package's dependency list and each barrel's already-resolved re-export
 * targets. No source parsing and no compiler, so this group runs at full
 * strength on JS-only repos where the import-graph checks degrade to a skip
 * note.
 *
 * Every rule here carries its doc's framework carve-out, because the docs do:
 * `components/` is banned as a module name and mandated by React, kebab-case
 * folders are wrong by default and correct under NestJS. A rule that ignored
 * them would flood the work-list, and a flooded work-list is how a refactor
 * agent starts declining batches.
 */
export const checkPathsAndNames: StandardsPass = async ({ cwd, files, tests }) => {
	const carveOuts = await readFrameworkCarveOuts({ cwd, files });
	const modules = await mapFolderModules({ cwd, files });

	return [...checkFolderRules({ files, carveOuts }), ...checkTestPathRules({ tests, files, modules })];
};
