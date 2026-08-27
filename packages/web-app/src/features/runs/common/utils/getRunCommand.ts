import { PipelineKind } from '@lightsout/engine/contracts';
import { RunCommand } from '#src/features/runs/common/constants/RunCommand.ts';

/** Which command a reader invoked to produce each pipeline. */
const commandsByPipeline: Record<string, RunCommand> = {
	[PipelineKind.Implement]: RunCommand.Implement,
	[PipelineKind.Phases]: RunCommand.ImplementPhased,
	[PipelineKind.Refactor]: RunCommand.Refactor,
	[PipelineKind.Coverage]: RunCommand.Coverage,
};

interface Params {
	pipeline: string;
}

/**
 * A run's pipeline as the command a reader typed.
 *
 * A pipeline this app does not know reads as itself: `RunListing.pipeline` is
 * deliberately a plain string so a row survives a value a newer engine records,
 * and a row labelled with the raw word is better than one labelled wrongly.
 */
export const getRunCommand = ({ pipeline }: Params): string => commandsByPipeline[pipeline] ?? pipeline;
