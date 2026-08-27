import { z } from 'zod';
import { CommandFlag } from '#src/contracts/commands/CommandFlag.ts';
import { CommandGroup } from '#src/contracts/commands/CommandGroup.ts';
import { CommandInvocation } from '#src/contracts/commands/CommandInvocation.ts';
import { CommandRecordKind } from '#src/contracts/commands/CommandRecordKind.ts';
import { CommandStep } from '#src/contracts/commands/CommandStep.ts';

/** One command lightsout offers: how it is invoked, when to reach for it, and what it leaves behind. */
export const CommandCatalogEntry = z.object({
	/** The word after `lightsout`, and the `$command` route param. */
	id: z.string(),
	/** The slash form when the plugin ships a skill for it, e.g. '/implement'. */
	slash: z.string().optional(),
	/** The CLI form, always: 'lightsout implement'. Absent for a skill-only command. */
	cli: z.string().optional(),
	group: z.enum(CommandGroup),
	/** One line — matches the skill's frontmatter `description` first sentence where a skill exists. */
	summary: z.string(),
	/** A paragraph: when to reach for it. */
	whenToUse: z.string(),
	invocations: z.array(CommandInvocation).default([]),
	flags: z.array(CommandFlag).default([]),
	/** The step sequence, when this command has one worth drawing. */
	steps: z.array(CommandStep).default([]),
	records: z.enum(CommandRecordKind),
	/**
	 * Ids of related commands — filled by rule, not taste: every other member of
	 * the entry's `CommandGroup`, plus the explicit pairs listed in
	 * commandCatalog.ts's doc comment (plan↔implement, implement↔resume,
	 * refactor↔standards-check, test-coverage-to-threshold↔standards-check,
	 * standards-validate↔standards-health, friction↔improve). Symmetric by
	 * construction.
	 */
	related: z.array(z.string()).default([]),
	/** Infographic title/subtitle/banner, when this command has a graphic. */
	graphic: z.object({ title: z.string(), subtitle: z.string(), banner: z.string(), columns: z.number() }).optional(),
});

export type CommandCatalogEntry = z.infer<typeof CommandCatalogEntry>;
