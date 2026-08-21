export const StandardsInputKind = {
	/** Path lists only — no file is opened. */
	FileList: 'file-list',
	/** Path lists plus a contents map; each file read once, shared across checks. */
	FileText: 'file-text',
	/** The consumer's TypeScript plus one parsed SourceFile per source file. */
	SyntaxTree: 'syntax-tree',
	/** The same trees, each paired with a type checker that resolves names across files. */
	TypeChecker: 'type-checker',
	/** Test files plus their text. */
	TestFile: 'test-file',
	/** Resolved import edges among the files in scope. */
	ImportGraph: 'import-graph',
	/** Engine-run token-duplication spans (jscpd), honoring the rule's own settings. */
	CloneSpans: 'clone-spans',
} as const;

export type StandardsInputKind = (typeof StandardsInputKind)[keyof typeof StandardsInputKind];
