import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout self-check` — the engine's own check, granted to a writing agent and run inside that agent's own spawn. */
export const selfCheckCatalogEntry: CommandCatalogEntry = {
	id: 'self-check',
	cli: 'lightsout self-check',
	group: CommandGroup.Build,
	summary: "The engine's own check of a writing agent's change, run by that agent before it reports.",
	whenToUse:
		"Nothing a human reaches for. The engine grants it to the feature executor, the refactor executor and the direct worker inside their own spawns, so an agent sees the cheap gates it is about to be judged on while its context is still loaded. It takes the live run id and reads everything else from that run — and it decides nothing: the engine's own gates run afterwards over the full scope and are the only verdict.",
	invocations: [{ id: 'self-check' }],
	flags: [
		{ name: 'run', value: '<id>', meaning: 'The live run whose manifest says which step, schedule and scope this check mirrors.', required: true },
		{ name: 'cwd', value: '<path>', meaning: 'Repository the run belongs to.', fallback: 'The process working directory.', required: false },
	],
	steps: [],
	records: CommandRecordKind.Nothing,
	related: ['auto-plan', 'brainstorm', 'plan', 'implement', 'implement-direct', 'resume', 'ship', 'queue', 'ticket-state'],
};
