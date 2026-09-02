import { commandCatalog } from '#src/commands/commandCatalog.ts';
import { spellFlag } from '#src/commands/spellFlag.ts';
import type { CommandCatalogEntry, CommandFlag, CommandInvocation } from '#src/contracts/index.ts';

/**
 * Every invocation id in the order `lightsout --help` prints it.
 *
 * Not catalog order: the catalog is grouped for the commands page, and the
 * usage text has its own order, which readers and screenshots have seen for
 * months. Kept here rather than exported, so this file holds one export — the
 * coverage test works through `renderUsage()`'s output instead, which catches a
 * missing id just as surely.
 */
const usageOrder = [
	'implement',
	'implement-folder',
	'implement-direct',
	'resume',
	'ship',
	'queue',
	'status',
	'status-run',
	'doctor',
	'standards-check',
	'standards-check-list',
	'standards-validate',
	'standards-health',
	'refactor',
	'refactor-resume',
	'test-coverage-to-threshold',
	'test-coverage-to-threshold-resume',
	'plan-verify-facts',
	'plan-draft',
	'plan-lint',
	'plan-dedup',
	'plan-grade',
	'plan-publish',
	'friction',
	'improve',
	'voice-toggle',
	'voice-hook',
];

/** Every flag sharing an exclusivity key, in one bracket: `[--code-checks | --agent-review]`. */
const renderExclusiveGroup = ({ flags, key }: { flags: CommandFlag[]; key: string }) => {
	const group = flags.filter((flag) => flag.exclusiveWith === key);

	return `[${group.map((flag) => spellFlag({ flag })).join(' | ')}]`;
};

/**
 * The flags one invocation shape shows, in the entry's own order.
 *
 * A flag with no `shape` belongs to every shape; one with a `shape` appears
 * only on that line. Flags sharing an `exclusiveWith` key collapse into a
 * single bracket at the position of the first of them.
 */
const renderFlags = ({ entry, invocation }: { entry: CommandCatalogEntry; invocation: CommandInvocation }) => {
	const shown = entry.flags.filter((flag) => flag.shape === undefined || flag.shape === invocation.id);
	const rendered: string[] = [];
	const groupsSeen = new Set<string>();

	for (const flag of shown) {
		if (flag.exclusiveWith === undefined) {
			rendered.push(flag.required ? spellFlag({ flag }) : `[${spellFlag({ flag })}]`);
		} else if (!groupsSeen.has(flag.exclusiveWith)) {
			groupsSeen.add(flag.exclusiveWith);
			rendered.push(renderExclusiveGroup({ flags: shown, key: flag.exclusiveWith }));
		}
	}

	return rendered;
};

/** The parenthetical gloss, aligned to its column: 55, one-based, with a three-space minimum for a line that already reaches it. */
const padNote = ({ body, note }: { body: string; note: string }) => `${body}${' '.repeat(Math.max(3, 54 - body.length))}(${note})`;

/** One usage line: two spaces, the command word, the shape's positional words, its flags, and its note. */
const renderLine = ({ cli, entry, invocation }: { cli: string; entry: CommandCatalogEntry; invocation: CommandInvocation }) => {
	const words = [cli, invocation.positional, ...renderFlags({ entry, invocation })].filter((word) => word !== undefined);
	const body = `  ${words.join(' ')}`;

	return invocation.note === undefined ? body : padNote({ body, note: invocation.note });
};

/**
 * The `lightsout --help` text, rendered from the command catalog.
 *
 * One line per id in `usageOrder`, so a skill-only entry — `brainstorm`, which
 * carries neither a `cli` nor an invocation — is never emitted and needs no
 * exclusion rule of its own.
 */
export const renderUsage = (): string => {
	const header = 'lightsout — deterministic engine for coding agents\n\nusage:';
	// Belongs to the usage text rather than to any one command, which is why no
	// catalog entry carries it.
	const exitCodes = `exit codes (implement, resume, refactor, test-coverage-to-threshold):
  0  finished
  2  stopped with work left and resumable — a --max-batches ceiling, or a harness rate limit
  1  anything else`;
	const lines: string[] = [];

	for (const id of usageOrder) {
		const entry = commandCatalog.find((candidate) => candidate.invocations.some((invocation) => invocation.id === id));
		const invocation = entry?.invocations.find((candidate) => candidate.id === id);

		if (entry?.cli !== undefined && invocation !== undefined) {
			lines.push(renderLine({ cli: entry.cli, entry, invocation }));
		}
	}

	return `${header}\n${lines.join('\n')}\n\n${exitCodes}\n`;
};
