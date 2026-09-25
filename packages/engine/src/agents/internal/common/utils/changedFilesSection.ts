interface Params {
	/** The files created or modified earlier in this run, absent on a spawn that is the run's first attempt. */
	changedFiles?: string[];
}

/**
 * The section listing what earlier attempts in this run already wrote, so a
 * re-invocation continues that work in place rather than starting over.
 *
 * One text, shared by the executor's brief and the direct worker's, because the
 * list means the same thing to both.
 *
 * @returns the section, or undefined for a spawn with nothing changed yet — the section is omitted rather than emitted empty.
 */
export const changedFilesSection = ({ changedFiles }: Params): string | undefined =>
	changedFiles === undefined || changedFiles.length === 0
		? undefined
		: `# Previously changed files\n\nFiles already created or modified earlier in this run:\n\n${changedFiles.map((file) => `- ${file}`).join('\n')}`;
