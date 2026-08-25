import type ts from 'typescript';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import { listSourceFiles } from '#src/common/sourceFiles/listSourceFiles.ts';
import { type RawStandardsFinding, type StandardsCheckFunction, StandardsInputKind } from '#src/contracts/index.ts';
import { buildCheckInput } from '#src/standardsCheck/common/checkInputs/buildCheckInput.ts';
import { runRuleCheck } from '#src/standardsCheck/common/utils/runRuleCheck.ts';
import type { LoadedStandardsRule } from '#src/standardsPacks/index.ts';

interface Params {
	/** Absolute path of the tree to check, run against as if it were a whole repo. */
	cwd: string;
	rule: LoadedStandardsRule;
	inputKind: StandardsInputKind;
	run: StandardsCheckFunction;
	/** How a thrown message names the tree — `fixtures/pass/`, `fixtures/framework-owned/nestjs/`. */
	label: string;
	compiler?: typeof ts;
}

/**
 * One rule's check, run against one fixture tree as if that tree were a whole repo.
 *
 * The tree is named by the caller rather than derived here, because the two
 * callers name theirs differently: a rule's own pair is `fixtures/<side>/`
 * under the rule folder, and the pack-level framework-owned trees sit nowhere
 * near it.
 *
 * @param cwd - absolute path of the tree to check
 * @param label - how a thrown message names the tree
 * @throws {Error} When a type-checker rule's tree carries no tsconfig, or the check itself misbehaves.
 */
export const checkFixtureTree = async ({ cwd, rule, inputKind, run, label, compiler }: Params): Promise<RawStandardsFinding[]> => {
	const { files } = await listSourceFiles({ cwd });
	const input = await buildCheckInput({
		kind: inputKind,
		cwd,
		source: files.filter((file) => !isTestFile({ path: file })),
		tests: files.filter((file) => isTestFile({ path: file })),
		files,
		referenceFiles: files,
		// A fixture tree is a miniature repo of its own; it declares no pack.
		standardsPacks: [],
		packagesDir: defaultPackagesDir,
		settings: rule.defaultSettings,
		cache: new Map<string, string>(),
		compiler,
	});

	// A fixture tree is its own miniature repo, and a type-checker input needs a
	// tsconfig to build a program from. Without one the check is handed nothing
	// and answers nothing, which would otherwise be reported as "the check does
	// not catch what the rule describes" — the wrong file to go looking in.
	if (input.kind === StandardsInputKind.TypeChecker && input.typedFiles.size === 0 && files.length > 0) {
		throw new Error(`no tsconfig.json in ${label}, so none of its ${files.length} file(s) could be typed — a type-checker rule's fixtures need one`);
	}

	return runRuleCheck({ rule: rule.id, run, input, settings: rule.defaultSettings });
};
