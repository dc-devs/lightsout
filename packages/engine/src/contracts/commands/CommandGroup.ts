/** Which shelf a command sits on — the heading it appears under on the commands page. */
export const CommandGroup = {
	Build: 'build',
	BurnDown: 'burn-down',
	Standards: 'standards',
	Housekeeping: 'housekeeping',
} as const;

export type CommandGroup = (typeof CommandGroup)[keyof typeof CommandGroup];
