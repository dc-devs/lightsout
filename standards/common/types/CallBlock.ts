export interface CallBlock {
	callee: string;
	/** The call's first argument when it is a string literal — a describe or test title. Empty when the call has no literal title, as a hook never does. */
	title: string;
	/** The callback body's text, braces excluded. */
	body: string;
	/** 1-based line the call opened on. */
	startLine: number;
	/** 1-based line the call closed on. */
	endLine: number;
	/** How many blocks of any requested callee enclose this one — 0 at file scope. */
	depth: number;
}
