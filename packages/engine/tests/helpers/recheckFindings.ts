import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@jest/globals';
import { GapArea, GapCheckLens, GapOutcome, type GapVerdict, type GradeFindingRecord, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { memoryFor } from '#tests/helpers/gradeScopeInputs.ts';

/** One line of each plan file, long enough to be quoted back as a citation the engine can confirm. */
export const firstPhaseLine = 'The judge that times out leaves its own record open and blocking.';
export const secondPhaseLine = 'The queue stops on the first rate-limited spawn of the whole pass.';
export const overviewLine = 'This deliverable is graded as two phases and one overview.';

const firstPhaseText = `# Phase 1\n\n## Decision Log\n\n${firstPhaseLine}\n`;
const secondPhaseText = `# Phase 2\n\n## Decision Log\n\n${secondPhaseLine}\n`;
export const overviewText = `# Overview\n\n${overviewLine}\n`;

/** What each stub judge answers, or a spawn that never produced an answer at all. */
type Answer = GapVerdict | 'failed' | 'rate-limited';

/**
 * A re-verification stub keyed on the gap text the record section of each prompt
 * carries, so one run can answer differently per record whatever order the
 * fan-out starts them in.
 */
const createRecheckDriver = ({ answers, invocations }: { answers: Record<string, Answer>; invocations: DriverInvocation[] }): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		// the one marker a re-verification spawn carries — an invocation without it
		// reached this driver from somewhere else, which is a wiring bug
		expect(invocation.prompt.includes('# Finding-recheck input')).toBeTruthy();

		const answer = Object.entries(answers).find(([gap]) => invocation.prompt.includes(gap))?.[1];

		if (answer === 'rate-limited') {
			return { text: '', exitCode: 1, rateLimited: true };
		}

		if (answer === undefined || answer === 'failed') {
			return { text: 'not json at all', exitCode: 1 };
		}

		return { text: JSON.stringify(answer), exitCode: 0 };
	},
});

/** One open record as a pass left it: a human's question nobody has verified as answered. */
export const recordOf = (overrides: Partial<GradeFindingRecord> = {}): GradeFindingRecord => ({
	id: 'f1',
	phase: 'phase-1-reader.md',
	lens: GapCheckLens.Decisions,
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no failure mode',
	decision: 'what to return when the judge times out',
	options: [],
	firstSeen: '2026-01-01T00:00:00.000Z',
	lastSeen: '2026-01-01T00:00:00.000Z',
	status: GradeFindingStatus.Open,
	disposition: GapOutcome.NeedsAHuman,
	humanDecision: 'pick the failure mode',
	observations: [],
	resolutions: [],
	reopened: [],
	...overrides,
});

/** The shared call shape: a two-phase deliverable, a stub judge per record, and a fresh workspace to drop transcripts in. */
export const setupRecheck = async ({
	findings,
	answers,
	overview,
	onDisk = [],
	skipReason,
	invalidated = [],
}: {
	findings: GradeFindingRecord[];
	answers: Record<string, Answer>;
	overview?: string;
	onDisk?: string[];
	/** Set when the caller met the rate-limit wall before this fan-out was reached. */
	skipReason?: string;
	/** The plan-file basenames whose read coverage fell this pass; empty is the quiet case, where only a never-asked record is asked. */
	invalidated?: string[];
}) => {
	const cwd = await freshCwd();
	const invocations: DriverInvocation[] = [];

	for (const path of onDisk) {
		await mkdir(join(cwd, 'src'), { recursive: true });
		await writeFile(join(cwd, path), 'export const answer = 1;\n', 'utf8');
	}

	return {
		invocations,
		params: {
			cwd,
			driver: createRecheckDriver({ answers, invocations }),
			workspaceDir: cwd,
			overviewText: overview,
			files: [
				{ path: join(cwd, 'phase-1-reader.md'), text: firstPhaseText },
				{ path: join(cwd, 'phase-2-judge.md'), text: secondPhaseText },
			],
			memory: memoryFor({ findings }),
			at: '2026-02-02T00:00:00.000Z',
			skipReason,
			invalidated,
		},
	};
};

/** The record the run returned under a given id — the fold keeps every member, so a missing one is a failure worth reading. */
export const recordIn = ({ memory, id }: { memory: GradeMemory; id: string }): GradeFindingRecord | undefined =>
	memory.findings.find((record) => record.id === id);

/** How the second plan file's reader worded the same defect — deliberately none of the representative's words, so a prompt carrying it can be told apart. */
export const secondObservationGap = 'the queue has no rule for a spawn that never answers';
export const secondObservationDecision = 'how long one spawn may run before the pass gives up on it';

/** One open record a judge confirmed as a shared defect: its representative sits in the first plan file, and a second observation in the second. */
export const twoLocationRecordOf = (): GradeFindingRecord =>
	recordOf({
		observations: [
			{
				phase: 'phase-1-reader.md',
				lens: GapCheckLens.Decisions,
				area: GapArea.OmittedDecision,
				gap: 'the plan picks no failure mode',
				decision: 'what to return when the judge times out',
				options: [],
			},
			{
				phase: 'phase-2-judge.md',
				lens: GapCheckLens.Wiring,
				area: GapArea.PhaseSeamMismatch,
				gap: secondObservationGap,
				decision: secondObservationDecision,
				options: [],
			},
		],
		resolutions: [],
	});
