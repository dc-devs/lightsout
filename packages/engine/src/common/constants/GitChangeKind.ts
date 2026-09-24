/** What one working-tree path is, relative to `HEAD`. */
export const GitChangeKind = {
	Added: 'added',
	Modified: 'modified',
	Removed: 'removed',
} as const;

export type GitChangeKind = (typeof GitChangeKind)[keyof typeof GitChangeKind];
