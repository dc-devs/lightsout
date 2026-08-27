import type { CommandCatalogEntry } from '@lightsout/engine';
import { CommandGroup, CommandRecordKind } from '@lightsout/engine/contracts';

interface Params {
	id?: string;
	slash?: string;
	cli?: string;
	group?: CommandGroup;
	summary?: string;
	whenToUse?: string;
	records?: CommandRecordKind;
	related?: string[];
	/** Applied last, so a test can drop an optional field the defaults fill — `{ slash: undefined }`. */
	overrides?: Partial<CommandCatalogEntry>;
}

/** One command's catalog row, as `listCommands` hands it back — the flags, invocations and steps a card never reads left empty. */
export const buildCommandCatalogEntry = ({
	id = 'implement',
	slash = '/implement',
	cli = 'lightsout implement',
	group = CommandGroup.Build,
	summary = 'Run a graded plan to done, unattended.',
	whenToUse = 'Run it when a plan is graded and you want the work done unattended.',
	records = CommandRecordKind.Runs,
	related = [],
	overrides = {},
}: Params = {}): CommandCatalogEntry => ({
	id,
	slash,
	cli,
	group,
	summary,
	whenToUse,
	invocations: [],
	flags: [],
	steps: [],
	records,
	related,
	...overrides,
});
