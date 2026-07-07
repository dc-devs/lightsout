/** A parsed plan file: its `##` sections plus the paths and scripts the checks key off. */
export interface ParsedPlan {
	base: string;
	title: string;
	variant: 'implementable' | 'overview';
	/** `## Section title` → the lines beneath it (up to the next `##`). */
	sections: Map<string, string[]>;
	createPaths: string[];
	modifyPaths: string[];
	mirrorPaths: string[];
	verificationCommands: string[];
	lines: string[];
}
