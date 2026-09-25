import { join } from 'node:path';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';

/**
 * Which command's folder holds a run that belongs to no plan.
 *
 * Implement and phases answer the same folder, because a coordinator and the
 * plan it sequences are one command's work; the other four each answer their
 * own. The map lives beside the function it serves: it is tautologically
 * coupled to the parameter's type, and a second file for it would be a lookup
 * nobody can find from the function that reads it.
 */
const commandFolders: Record<PipelineKind, string> = {
	[PipelineKind.Implement]: 'implement',
	[PipelineKind.Phases]: 'implement',
	[PipelineKind.Direct]: 'direct',
	[PipelineKind.Refactor]: 'refactor',
	[PipelineKind.Coverage]: 'coverage',
	[PipelineKind.Queue]: 'queue',
};

interface Params {
	/** The `.lightsout` folder the command folders sit in, already resolved to the primary checkout. */
	stateDir: string;
	pipeline: PipelineKind;
}

/** The runs folder of the command that owns a run belonging to no plan: `<state>/<command>/runs`. */
export const getCommandRunsDir = ({ stateDir, pipeline }: Params): string => join(stateDir, commandFolders[pipeline], 'runs');
