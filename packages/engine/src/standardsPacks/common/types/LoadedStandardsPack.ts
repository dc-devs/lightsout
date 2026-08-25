import type { LoadedStandardsDocument } from '#src/standardsPacks/common/types/LoadedStandardsDocument.ts';
import type { LoadedStandardsRule } from '#src/standardsPacks/common/types/LoadedStandardsRule.ts';

/** A whole standards pack as the loader read it off disk. */
export interface LoadedStandardsPack {
	name: string;
	formatVersion: number;
	/**
	 * Present and true for a pack the bundler produced, which ships without the
	 * fixture pairs and unit tests that prove it; absent for an authored one,
	 * exactly as the root file carries it. Nothing about running a pack depends
	 * on this — only `lightsout standards-validate`, which has nothing to run
	 * against a built pack and says so rather than blaming its rules.
	 */
	built?: true;
	/** Absolute pack root. */
	rootPath: string;
	/**
	 * Absolute path of `<pack>/fixtures/framework-owned/`, present only when the
	 * pack ships one. Each child folder is one framework's miniature repo, and
	 * every checked rule is held to silence on all of them — the invariant that
	 * keeps a rule written next year from judging code its framework owns.
	 *
	 * Recorded at load, demanded by nobody: a pack without one gets a note from
	 * `standards-validate`, the same stance a rule's own `fixturesPath` takes.
	 */
	frameworkOwnedFixturesPath?: string;
	/**
	 * Absolute path of `<pack>/common/frameworks/getFrameworkFacts.ts`, present
	 * only when the pack ships one.
	 *
	 * The engine keeps mirrors of a few pack helpers — `collectFolderModules`
	 * mirrors `mapFolderModules` — and those mirrors ask the pack which files a
	 * framework loads rather than holding the dependency table themselves, so the
	 * pack a repo configured is what answers.
	 *
	 * Recorded, never required: a pack without one leaves the mirrors answering
	 * no, which is what they did before this surface existed.
	 */
	frameworksModulePath?: string;
	documents: LoadedStandardsDocument[];
	rules: LoadedStandardsRule[];
}
