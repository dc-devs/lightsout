export interface CloneSpan {
	/** Both sites of one duplicated token span. */
	files: Array<{ path: string; startLine: number; endLine: number }>;
	tokens: number;
}
