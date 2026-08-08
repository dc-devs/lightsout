export const StandardsPassId = {
	/** Name-level comparison over source files. */
	FilenameDuplicates: 'filename-duplicates',
	/** jscpd token-span clone detection. */
	Clones: 'clones',
	/** One AST walk: normalized-body duplicates plus the size audit. */
	AstFindings: 'ast-findings',
	/** Text-level structure lint: exports per file, filename match, domain grouping, folder census. */
	Structure: 'structure',
	/** Whole-word reference counting for unreferenced exports. */
	DeadExports: 'dead-exports',
	/** Barrel parsing: star re-exports and unconsumed entries. */
	BarrelHygiene: 'barrel-hygiene',
	/** Import-graph boundary crossings. */
	ModuleBoundaries: 'module-boundaries',
	/** Import-graph leaks out of a module's common/. */
	Placement: 'placement',
	/** Text-level shape rules over test files. */
	TestShape: 'test-shape',
} as const;

export type StandardsPassId = (typeof StandardsPassId)[keyof typeof StandardsPassId];
