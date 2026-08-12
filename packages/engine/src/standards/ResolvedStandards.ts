/** Both standards sets a run was given, and how the framework channels behind them were decided. */
export interface ResolvedStandards {
	standards?: string;
	testStandards?: string;
	/** Framework channels in play, for the caller's progress line. */
	channels: string[];
	/** Channels came from config rather than dependency detection. */
	configured: boolean;
	/** Some standards were asked for — false when the consumer loaded no packages. */
	requested: boolean;
}
