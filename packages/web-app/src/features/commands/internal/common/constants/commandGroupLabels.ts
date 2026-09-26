import { CommandGroup } from '@lightsout/engine/contracts';

/** Each command group as the commands page heads it. */
export const commandGroupLabels: Record<CommandGroup, string> = {
	[CommandGroup.Build]: 'Build',
	[CommandGroup.BurnDown]: 'Burn down',
	[CommandGroup.Standards]: 'Standards',
	[CommandGroup.Housekeeping]: 'Housekeeping',
};
