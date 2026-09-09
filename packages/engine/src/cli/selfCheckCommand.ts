import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { red } from '#src/cli/common/terminal/red.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { PipelineKind } from '#src/contracts/index.ts';
import { runSelfCheck, SelfCheckReason, type SelfCheckResult } from '#src/gates/index.ts';
import { readRunManifest } from '#src/runState/index.ts';

/** What this step's self-check mirrors: the checkpoint it precedes, whether coverage can answer truthfully, and what it is scoped to. */
interface StepSelfCheck {
	/** The checkpoint this self-check mirrors, undefined for a pipeline that names none — spelled out so spreading this always carries the key. */
	checkpoint: string | undefined;
	coverage: boolean;
	wholeRepository: boolean;
}

/** The closing sentence every ending carries — nothing an agent runs decides whether a step passed. */
const verdictLine = "The engine's own gates run afterwards over the full scope and are the only verdict.";

/**
 * The headline for an ending that ran no gate. None of the four says anything is
 * wrong with the change, and none of them may read as a check that passed.
 */
const noGateHeadlines: Record<Exclude<SelfCheckReason, typeof SelfCheckReason.Ran>, string> = {
	[SelfCheckReason.NothingChanged]: 'nothing to check — the tree holds no change yet',
	[SelfCheckReason.NothingScheduled]:
		'no gates were run — the checkpoint this step precedes schedules none, or every package in scope skipped the ones it does',
	[SelfCheckReason.Unavailable]:
		"the engine could not work out what to check — reading this repository's git status failed, which is the engine failing rather than your change being red",
	[SelfCheckReason.Coordination]:
		'no gates were run — another gate run of this repository holds the machine, so this check was still waiting for it rather than your change being red',
};

/**
 * This step's self-check, or nothing where the step has none.
 *
 * Both verification checkpoints map as well as the steps they follow, because a
 * fix re-invocation is the same role built by the same builder: a fix spawn that
 * re-runs the gate it is repairing is where the second repair is saved, and
 * mapping it keeps the role's system prompt byte-identical between a step and
 * its own fix re-invocation.
 */
const selfCheckOfStep = ({ pipeline, step }: { pipeline: PipelineKind | undefined; step: string }): StepSelfCheck | undefined => {
	// The direct pipeline names no checkpoints and runs the root block over the
	// whole tree with coverage on, so its self-check mirrors that rather than the
	// diff-scoped one.
	if (pipeline === PipelineKind.Direct) {
		return step === 'implement' ? { checkpoint: undefined, coverage: true, wholeRepository: true } : undefined;
	}

	// A manifest predating the discriminator reads as the implement pipeline,
	// which is how every other reader treats one.
	if (pipeline !== undefined && pipeline !== PipelineKind.Implement) {
		return undefined;
	}

	if (step === 'implement' || step === 'verify-implement') {
		return { checkpoint: 'verify-implement', coverage: false, wholeRepository: false };
	}

	return step === 'refactor' || step === 'verify-refactor' ? { checkpoint: 'verify-refactor', coverage: true, wholeRepository: false } : undefined;
};

/** The run's manifest, or the one line explaining why it could not be read — never a stack trace in the agent's shell. */
const readManifest = async ({ cwd, runId }: { cwd: string; runId: string }) => {
	try {
		return { manifest: await readRunManifest({ cwd, runId }) };
	} catch (error) {
		return { error: messageOf({ error }) };
	}
};

/** What the gates found, as evidence about the code: the command that went red and the output it left. */
const printGateFailures = ({ result }: { result: SelfCheckResult }) => {
	for (const gate of result.gates) {
		if (gate.skipped !== true && gate.exitCode !== undefined && gate.exitCode !== 0) {
			console.log(`\n${bold(`[${gate.group}] ${gate.kind}`)} — exit ${gate.exitCode}\n${gate.command}\n${gate.outputTail ?? ''}`);
		}
	}

	// A crash is the engine's own failure rather than evidence about the code, so
	// it is printed as one and never handed over as something to repair.
	for (const crash of result.crashes) {
		console.log(`\nengine: ${crash}`);
	}
};

/**
 * The engine's own check of a writing agent's change, run by that agent inside
 * its own spawn.
 *
 * It takes the live run's id and nothing else: step, pipeline, gate schedule and
 * coverage answer are read from that run's manifest, and package scope from the
 * live git diff, so an argument an agent appends can never widen what it runs.
 * It never takes the run lock — the run that spawned the agent already holds it
 * — and it writes nothing to the run's manifest.
 */
export const selfCheckCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const runId = await getRequiredFlag({ flags, name: 'run' });
	const found = await readManifest({ cwd, runId });

	if ('error' in found) {
		console.error(`self-check: ${found.error}`);

		return exitCli({ code: 1 });
	}

	const { manifest } = found;
	const config = await readConfig({ cwd });
	const step = manifest.currentStep;
	const resolved = step === null ? undefined : selfCheckOfStep({ pipeline: manifest.pipeline, step });

	if (step === null || resolved === undefined) {
		console.log(`\n${bold(`self-check ${step ?? 'no step'}`)} — this step has no self-check, so nothing was checked. ${verdictLine}`);

		return exitCli({ code: 0 });
	}

	const result = await runSelfCheck({ cwd, config, ...resolved, runId: manifest.runId, step, onProgress: createProgressPrinter() });
	const failed = result.reason === SelfCheckReason.Ran && result.error !== undefined;
	const ranHeadline = failed ? red('gates red') : green('passed');
	const headline = result.reason === SelfCheckReason.Ran ? ranHeadline : noGateHeadlines[result.reason];
	const scheduled = result.gateNames.length === 0 ? '' : ` (${result.gateNames.join(', ')})`;

	console.log(`\n${bold(`self-check ${step}`)} — ${headline}${scheduled}. ${verdictLine}`);

	// Who holds the machine, in which worktree, and for how long — printed under
	// the headline, and never alongside gate evidence, because no gate ran.
	if (result.coordination !== undefined) {
		console.log(`\n${result.coordination}`);
	}

	if (result.reason === SelfCheckReason.Ran) {
		printGateFailures({ result });
	}

	return exitCli({ code: failed ? 1 : 0 });
};
