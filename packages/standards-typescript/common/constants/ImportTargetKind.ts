/** What a resolved module specifier turned out to name — the discriminant of {@link ImportTarget}. */
export const ImportTargetKind = {
	/** A file in the run's scope, named by path. */
	File: 'file',
	/** A published package or a builtin: no local file, and there never was one. */
	External: 'external',
	/** Could name a local file, but the mapping needed to say which was unavailable. */
	Unknown: 'unknown',
} as const;

export type ImportTargetKind = (typeof ImportTargetKind)[keyof typeof ImportTargetKind];
