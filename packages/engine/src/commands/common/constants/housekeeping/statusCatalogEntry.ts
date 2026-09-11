import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout status` — what lightsout sees here, either across every run or inside one of them. */
export const statusCatalogEntry: CommandCatalogEntry = {
	id: 'status',
	cli: 'lightsout status',
	group: CommandGroup.Housekeeping,
	summary: 'Show what lightsout sees in this repo: config, harness, packs, any run still parked — and, for one run, what it is doing right now.',
	whenToUse:
		'Run it when you come back to a repo and need to know what lightsout thinks is going on. It names the config, the harness, the packs in play, and any run still parked. Name a run and it shows what is happening inside that run instead: its steps, their outcomes and durations, and what it is working on this moment. Name a branch with --shipping to follow it while it ships. Pass --queue while a queue drains to see every ticket on its board and what each active one is doing.',
	invocations: [
		{ id: 'status' },
		{ id: 'status-run', note: 'one run in detail; --watch repaints it every two minutes, and without --run it follows the one run that is going' },
		{ id: 'status-planning', note: "one plan's planning steps, printed once" },
		{ id: 'status-shipping', note: "one branch's ship steps, read from the checkout that ships it" },
		{ id: 'status-queue', note: "the queue's board, then one status block per active ticket, printed once" },
	],
	flags: [
		{
			name: 'run',
			value: '<id>',
			meaning: 'Show one run in detail — its steps, their outcomes and durations, what it is doing now. Takes the shortened eight-character id reports print.',
			fallback: 'Every run is listed, one line each.',
			shape: 'status-run',
			required: false,
		},
		{
			name: 'watch',
			meaning:
				'Repaint the detail block every two minutes until the run stops, so a detached run can be followed. Without --run it follows the one run that is going, and its phase children with it; when several unrelated runs are going it names their ids and asks for --run <id> instead of guessing.',
			fallback: 'The block is printed once.',
			shape: 'status-run',
			required: false,
		},
		{
			name: 'planning',
			value: '<name>',
			meaning:
				"Show the named plan folder's planning steps — verify-facts, draft, dedup, grade, publish — with their outcomes, attempts and durations, and what is running now. Cannot be combined with --run or --watch.",
			shape: 'status-planning',
			required: true,
		},
		{
			name: 'shipping',
			value: '<branch>',
			meaning:
				"Show the branch's ship steps — integrate, push, pull-request, checks, merge, sync — in the run block's layout, printed once, read from the record in the checkout --cwd names. Cannot be combined with --run, --watch or --planning.",
			shape: 'status-shipping',
			required: true,
		},
		{
			name: 'queue',
			meaning:
				"Show the queue's seven-column board — Build Queue, Building, Ship Queue, Shipping Now, Shipped, Parked, Blocked — then one block per active ticket, each exactly what --run, --planning or --shipping prints for that ticket's worktree. Printed once. Cannot be combined with --watch, --planning or --shipping.",
			shape: 'status-queue',
			required: true,
		},
		{
			name: 'run',
			value: '<id>',
			meaning: 'The queue run to show — a past or crashed one included. Takes the shortened eight-character id reports print.',
			fallback: "The live queue run this checkout's run lock names, waited for up to a minute.",
			shape: 'status-queue',
			required: false,
		},
		{ name: 'cwd', value: '<path>', meaning: 'Repository to report on.', fallback: 'The process working directory.', required: false },
	],
	steps: [],
	records: CommandRecordKind.Nothing,
	related: ['doctor', 'friction', 'improve', 'voice'],
};
