export const ScanDetector = {
	/** Tier 0: export names that collide or differ only by synonym/word order. */
	FilenameDuplicate: 'filename-duplicate',
	/** Tier 1: token-level copy-paste spans (jscpd). */
	Clone: 'clone',
	/** Tier 2: function bodies identical after identifier/literal normalization. */
	AstDuplicate: 'ast-duplicate',
	/** Size thresholds from the standards' numeric tables. */
	Size: 'size',
	/** One-export-per-file, filename↔export match, domain grouping, folder census. */
	Structure: 'structure',
	/** Exports nothing else references (outside barrels/tests). */
	DeadExport: 'dead-export',
} as const;

export type ScanDetector = (typeof ScanDetector)[keyof typeof ScanDetector];
