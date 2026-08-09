/** One re-export line of a barrel: the surface it exposes and the file it points at. */
export interface BarrelExport {
	/** The public names the line exposes — empty for an `export *` line, which names none. */
	names: string[];
	/** Whether the line re-exports with `export *` rather than named entries. */
	star: boolean;
	/** The module specifier exactly as written. */
	specifier: string;
	/** Repo-relative file the specifier resolves to, or undefined when it lands outside the files in scope. */
	target: string | undefined;
}
