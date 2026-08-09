export const LogLevel = {
	Debug: 'debug',
	Info: 'info',
	Error: 'error',
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

// Keyed by the union, so the two are tautologically coupled: every change to
// one is a change to the other.
export const logLevelLabels: Record<LogLevel, string> = {
	[LogLevel.Debug]: 'Debug',
	[LogLevel.Info]: 'Info',
	[LogLevel.Error]: 'Error',
};
