/** One exported name no production file references, and what still reaches it. */
export interface UnconsumedExport {
	/** Repo-relative path of the file declaring it. */
	file: string;
	/** The exported name. */
	name: string;
	/** What mentions it elsewhere. No source file does, or it would not be unconsumed. */
	reachedBy: {
		barrel: boolean;
		test: boolean;
	};
}
