/** The file-text input as a check reads it: what is in scope, what may reference it, and the text of both. */
export interface FileTexts {
	/** Repo-relative files in scope — the ones a rule may report on. */
	files: string[];
	/** The test files among them. */
	tests: string[];
	/** Files outside the scope that may still reference it, so a name is never called unused because the run was narrowed. */
	referenceFiles: string[];
	/** Text for every path in `files` and `referenceFiles`, read once for the whole run. */
	contents: Map<string, string>;
	/** Repo-relative standards pack roots — inside one, a `tests/` folder names a document set rather than a directory of tests. */
	standardsPacks: string[];
}
