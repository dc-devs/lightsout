import { CommandRecordKind } from '@lightsout/engine/contracts';

/** What a command leaves behind, as the badge on its card says it. */
export const recordKindLabels: Record<CommandRecordKind, string> = {
	[CommandRecordKind.Runs]: 'records runs',
	[CommandRecordKind.Plans]: 'records plans',
	[CommandRecordKind.Snapshots]: 'records snapshots',
	[CommandRecordKind.Nothing]: 'records nothing',
};
