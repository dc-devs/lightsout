/** One declaration a file exports on the line it defines it. */
export interface FileExport {
	/** The keyword that introduced it — `const`, `class`, `function`, `interface`, `type` or `enum`. */
	keyword: string;
	/** The name it binds. */
	name: string;
	/** The whole line, for the rules that must read what else the declaration says. */
	line: string;
}
