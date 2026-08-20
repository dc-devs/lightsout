import type { StandardsCheckRun, StandardsInputKind, StandardsSet, StandardsSeverity } from '#src/contracts/index.ts';

/** One rule folder, read: its prose, its declaration, and its check when it ships one. */
export interface LoadedStandardsRule {
	/** Folder name minus the numeric prefix — unique package-wide. */
	id: string;
	set: StandardsSet;
	/** Package-relative document folder path, e.g. 'code/style-guide/patterns/functions'. */
	documentPath: string;
	/** One line from rule.md front matter — what the rule catches. */
	summary: string;
	/** rule.md body — the rule's full prose argument. */
	prose: string;
	/** Inherited from the owning document's front matter — 'base' when it declares none. */
	channel: string;
	/** True when the folder declares (and ships) a machine check. */
	checked: boolean;
	defaultSeverity: typeof StandardsSeverity.Blocking | typeof StandardsSeverity.Advisory;
	defaultSettings: Record<string, number>;
	/** Present iff checked. */
	inputKind?: StandardsInputKind;
	/** The validated check, present iff checked. */
	run?: StandardsCheckRun;
	/** Absolute path of the folder holding pass/ and fail/. */
	fixturesPath: string;
}
