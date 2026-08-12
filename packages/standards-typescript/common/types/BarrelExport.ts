import type { ImportTarget } from './ImportTarget.ts';

/** One re-export line of a barrel: the surface it exposes and what it points at. */
export interface BarrelExport {
	/** The public names the line exposes — empty for an `export *` line, which names none. */
	names: string[];
	/** Whether the line re-exports with `export *` rather than named entries. */
	star: boolean;
	/** The module specifier exactly as written. */
	specifier: string;
	/** The file it resolves to, a package, or an answer this run could not give. */
	target: ImportTarget;
}
