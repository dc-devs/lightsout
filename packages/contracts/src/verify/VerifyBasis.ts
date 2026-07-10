export const VerifyBasis = {
	/** git-status dirty tree — the default. */
	DirtyTree: 'dirty-tree',
	/** git diff against --base <ref>, unioned with the dirty tree. */
	BaseRef: 'base-ref',
} as const;

export type VerifyBasis = (typeof VerifyBasis)[keyof typeof VerifyBasis];
