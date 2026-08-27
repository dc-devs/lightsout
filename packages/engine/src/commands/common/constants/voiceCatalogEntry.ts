import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `/lightsout:voice` — a setting and a hook entry point, which is why both shapes are positional rather than flagged. */
export const voiceCatalogEntry: CommandCatalogEntry = {
	id: 'voice',
	slash: '/lightsout:voice',
	cli: 'lightsout voice',
	group: CommandGroup.Housekeeping,
	summary: 'Turn the spoken read-out of lightsout interview questions on or off for this project — `/lightsout:voice on` and `/lightsout:voice off`.',
	whenToUse: 'Turn it on when you would rather hear the interview questions than watch for them. Mac-only, off until you turn it on, and per-project.',
	invocations: [
		{ id: 'voice-toggle', positional: 'on|off', note: 'toggle spoken read-out of interview questions — Mac-only' },
		{ id: 'voice-hook', positional: 'hook', note: 'hook entry for Stop + AskUserQuestion: reads hook JSON on stdin, speaks the question' },
	],
	flags: [{ name: 'cwd', value: '<path>', meaning: 'Project the setting belongs to.', fallback: 'The process working directory.', required: false }],
	steps: [],
	records: CommandRecordKind.Nothing,
	related: ['status', 'doctor', 'friction', 'improve'],
};
