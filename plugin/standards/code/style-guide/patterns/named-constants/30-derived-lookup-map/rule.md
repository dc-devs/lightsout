---
summary: "a constant that merely uses the union kept in the `const` object's file"
checked: false
severity: advisory
---

## Derived Lookup Maps May Co-Locate

A lookup map keyed by the union (`Record<Action, …>`) may live in the same file as the `const` object — the two are tautologically coupled, so every change to one changes the other.

```typescript
export const LogLevel = {
	Debug: 'debug',
	Info: 'info',
	Error: 'error',
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export const logLevelLabels: Record<LogLevel, string> = {
	[LogLevel.Debug]: 'Debug',
	[LogLevel.Info]: 'Info',
	[LogLevel.Error]: 'Error',
};
```

An unrelated constant that merely *uses* the union goes in `constants/` as usual.
