export const LogLevel = {
	Debug: 'debug',
	Info: 'info',
	Error: 'error',
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

// Not keyed by the union — it merely uses it, so it is an unrelated constant
// riding along in this file instead of living in `constants/` on its own.
export const defaultLogLevel: LogLevel = LogLevel.Info;
