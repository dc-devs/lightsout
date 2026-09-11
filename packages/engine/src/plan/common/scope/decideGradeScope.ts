import { basename } from 'node:path';
import { GradeFindingStatus, type GradeInputs, type GradeMemory, GradeScope } from '#src/contracts/index.ts';
import { getAffectedPhases } from '#src/plan/common/scope/getAffectedPhases.ts';
import { getDecisionReach } from '#src/plan/common/scope/getDecisionReach.ts';
import { getEditedPhases } from '#src/plan/common/scope/getEditedPhases.ts';
import { getPhaseConnections } from '#src/plan/common/scope/getPhaseConnections.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { GradeScopeDecision } from '#src/plan/common/types/GradeScopeDecision.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	/** Every implementable plan file with its text, in deliverable order. */
	files: DeliverableFile[];
	/** Overview text for a phased plan; absent for a single plan. */
	overviewText?: string;
	/** The memory as it was read at the start of this pass; absent when the file is not there. */
	memory?: GradeMemory;
	/** This pass's fingerprint. */
	inputs: GradeInputs;
	/** True when a human passed `--phase` — a narrowed pass is never reused and never focused. */
	narrowed: boolean;
}

/** The deliverable's plan files, parsed — the same shape the lint walks, built here because the decision reads the plan text itself. */
const parseFiles = ({ files }: { files: DeliverableFile[] }): PhaseFile[] =>
	files.map((file) => {
		const base = basename(file.path);

		return { path: file.path, base, number: Number(/^phase(\d+)-/.exec(base)?.[1] ?? 1), plan: parsePlan({ content: file.text, base }) };
	});

/** Every plan file the readers would be offered by a full pass. */
const everyPhase = ({ files }: { files: DeliverableFile[] }) => files.map((file) => basename(file.path));

/**
 * The closure a focused pass would read, or the reason the graph could not say —
 * kept separate from the rules above it so the fallback to a full review is one
 * branch rather than one per way of failing.
 */
const focusedClosure = ({ files, overviewText, edited }: { files: DeliverableFile[]; overviewText: string; edited: string[] }) => {
	const declarations = parsePhaseDeclarations({ plan: parsePlan({ content: overviewText, base: 'overview.md' }) });
	const graph = getPhaseConnections({ phases: parseFiles({ files }), declarations });

	return 'error' in graph ? { error: graph.error } : { phases: getAffectedPhases({ connections: graph.connections, edited }) };
};

/**
 * The phases a focused closure grows from: the edited phases, plus — for a
 * phased plan — the phases the changed decisions name, or the reason the
 * decision change cannot be placed. A single plan has no Decision Log part to
 * compare and keeps its edited phases alone.
 */
const closureSeeds = ({
	overviewText,
	inputs,
	previous,
	overviewChanged,
	edited,
	phases,
}: {
	overviewText?: string;
	inputs: GradeInputs;
	previous: GradeInputs;
	overviewChanged: boolean;
	edited: string[];
	phases: string[];
}) => {
	if (overviewText === undefined) {
		return { seeds: edited };
	}

	const reach = getDecisionReach({ current: inputs.decisionLog, previous: previous.decisionLog, overviewChanged, edited, phaseFiles: phases });

	return 'error' in reach ? { error: reach.error } : { seeds: [...edited, ...reach.phases] };
};

/**
 * How far this pass must reach, decided by the engine from the plan, the memory
 * and the fingerprint — there is no flag, because a human cannot know which
 * phases a repair can reach.
 *
 * The rules fire in order and every one of them falls back to a full review,
 * because the global constraint is that a cheaper pass must never turn an
 * unresolved blocker into an approval:
 *
 * 1. A `--phase` narrowing is a human's own choice and replaces nothing.
 * 2. An unread git probe is not evidence the code is unchanged, so it can
 *    neither be reused against nor narrowed against.
 * 3. A recorded passing full review over these very inputs is reported as
 *    current rather than paid for twice.
 * 4. With no memory, or no pass recorded in it, there is no baseline to compare
 *    the plan text against.
 * 5. A non-plan-text input moving means the recorded reading no longer speaks
 *    for this pass at all. An overview design change is context every phase
 *    shares; a Decision Log change reaches the phases its changed rows name; and
 *    a change whose reach cannot be placed is a full review.
 * 6. A single plan has no phase to narrow to.
 * 7. A plan with nothing open is not a repair check — approval needs the whole
 *    plan read, and a focused pass can never grant it.
 * 8. A graph that cannot be built cannot bound anything.
 * 9. A closure covering every file is a full pass by another name.
 */
export const decideGradeScope = ({ files, overviewText, memory, inputs, narrowed }: Params): GradeScopeDecision => {
	const phases = everyPhase({ files });
	const full = ({ reason }: { reason: string }): GradeScopeDecision => ({ scope: GradeScope.Full, phases, reuse: false, reason });

	if (narrowed) {
		return full({ reason: 'full review: a human narrowed this pass with --phase, which the engine never overrides' });
	}

	if (inputs.gradedCommit === undefined || inputs.changedFiles === undefined) {
		return full({ reason: 'full review: the git probe did not run, so the state of the code beside the plan is unknown' });
	}

	if (memory?.lastPassingFullReview?.inputs.sha256 === inputs.sha256) {
		return { scope: GradeScope.Full, phases, reuse: true, reason: 'the recorded passing full review already covers these inputs' };
	}

	const previous = memory?.lastPass?.inputs;

	if (previous === undefined) {
		return full({ reason: 'full review: no earlier pass is on record, so this pass is the baseline' });
	}

	const { edited, overviewChanged, otherInputChanged } = getEditedPhases({ current: inputs, previous });

	if (otherInputChanged) {
		return full({ reason: 'full review: the code, standards, configuration, prompts or model moved since the last pass' });
	}

	const seeded = closureSeeds({ overviewText, inputs, previous, overviewChanged, edited, phases });

	if ('error' in seeded) {
		return full({ reason: `full review: ${seeded.error}` });
	}

	if (files.length < 2 || overviewText === undefined) {
		return full({ reason: 'full review: a single plan file has no phase closure to narrow to' });
	}

	if (!memory?.findings.some((record) => record.status === GradeFindingStatus.Open)) {
		return full({ reason: 'full review: no finding is open, so this pass is an approval review rather than a repair check' });
	}

	const closure = focusedClosure({ files, overviewText, edited: seeded.seeds });

	if ('error' in closure) {
		return full({ reason: `full review: the phase graph could not be built — ${closure.error}` });
	}

	if (closure.phases.length >= files.length) {
		return full({ reason: 'full review: the edited phases reach every plan file anyway' });
	}

	const reach = closure.phases.length > 0 ? closure.phases.join(', ') : 'no phase text and no decision changed';
	const reason = `focused review: the edited phases, the phases changed decisions name, and everything they reach — ${reach}`;

	return { scope: GradeScope.Focused, phases: closure.phases, reuse: false, reason };
};
