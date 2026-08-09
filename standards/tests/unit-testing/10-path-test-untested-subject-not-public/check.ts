import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import type { FolderModule } from '../../../common/types/FolderModule.ts';
import { buildRawFinding } from '../../../common/utils/buildRawFinding.ts';
import { getBaseName } from '../../../common/utils/getBaseName.ts';
import { getTestSubject } from '../../../common/utils/getTestSubject.ts';
import { isUnderSrc } from '../../../common/utils/isUnderSrc.ts';
import { mapFolderModules } from '../../../common/utils/mapFolderModules.ts';
import { readBarrelTargets } from '../../../common/utils/readBarrelTargets.ts';
import { readFileTexts } from '../../../common/utils/readFileTexts.ts';

/**
 * A root-layer `common/` — one whose parent segment is `src`. The document's
 * classification table calls those files boundaries outright, and they have no
 * barrel to ask by design.
 */
const isUnderRootLayerCommon = ({ path }: { path: string }) => {
	const segments = path.split('/');

	return segments.some((segment, index) => segment === 'common' && segments[index - 1] === 'src');
};

const notPublicFinding = ({ test, files, moduleFolders }: { test: string; files: Set<string>; moduleFolders: Array<[string, FolderModule]> }) => {
	const subject = getTestSubject({ test, files });

	if (subject === undefined || isUnderRootLayerCommon({ path: subject })) {
		return undefined;
	}

	// No ancestor module means no boundary to be promoted through — the absence
	// of a barrel is not a missing export, so the rule stays silent.
	const ancestors = moduleFolders.filter(([folder]) => subject.startsWith(`${folder}/`));
	const nearest = ancestors[0];

	return nearest === undefined || ancestors.some(([, module]) => module.exportedTargets.has(subject))
		? undefined
		: buildRawFinding({
				rule: 'path-test-untested-subject-not-public',
				files: [{ path: test }],
				detail: `'${getBaseName({ path: subject })}' is not re-exported from ${nearest[1].barrelPath}`,
				guidance:
					"A direct test is a promotion, not an exception: add the subject to its module's barrel, or drive its coverage through the module's boundary instead. Existing ones are migration debt to leave in place — judge before acting.",
			});
};

export const check: StandardsCheckModule = {
	inputKind: 'file-text',
	run: ({ input }): RawStandardsFinding[] => {
		const { files, tests, contents, standardsPackages } = readFileTexts({ input });
		const fileSet = new Set(files);
		// Longest folder first, so a subject's FIRST ancestor here is its nearest
		// owning module — the one whose barrel it would be promoted into.
		const moduleFolders = [
			...mapFolderModules({
				files,
				getTargets: ({ barrelPath }) => readBarrelTargets({ barrelPath, text: contents.get(barrelPath) ?? '', files: fileSet }),
				standardsPackages,
			}),
		].sort(([first], [second]) => second.length - first.length);

		return tests
			.filter((test) => isUnderSrc({ path: test }))
			.map((test) => notPublicFinding({ test, files: fileSet, moduleFolders }))
			.filter((finding): finding is RawStandardsFinding => finding !== undefined);
	},
};
