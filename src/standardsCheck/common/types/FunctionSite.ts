/** One function body the AST tier measured: where it is, how big it is, and the hash its normalized tokens produced. */
export interface FunctionSite {
	name: string;
	path: string;
	startLine: number;
	endLine: number;
	hash: string;
	tokenCount: number;
}
