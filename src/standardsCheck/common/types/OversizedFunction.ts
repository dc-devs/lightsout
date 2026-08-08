/** One function measured over its cap, held until a file's oversized functions can be reported together. */
export interface OversizedFunction {
	name: string;
	/** What budget the name earned it: 'function', 'hook' or 'component'. */
	kind: string;
	lines: number;
	cap: number;
	startLine: number;
	endLine: number;
}
