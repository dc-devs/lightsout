import {
	GapArea,
	GapOutcome,
	type GradeDecisionLog,
	type GradeFindingRecord,
	type GradeFindingStatus,
	type GradeInputs,
	type GradeMemory,
	GradeScope,
} from '#src/contracts/index.ts';
import { phaseBody } from '#tests/helpers/phasePlan.ts';

/** The one timestamp every fixture is stamped with — nothing here is decided by time. */
export const passAt = '2026-01-01T00:00:00.000Z';

/**
 * A fingerprint with every non-plan-text input pinned, so a comparison between
 * two of these can only move on what a test actually varied. `probe` drops one
 * of the two git values entirely, which is not the same as setting it empty.
 *
 * The decision-log part is present by default, so a fixture's two passes
 * compare as a phased plan with no decision change. `design` is its hash of the
 * overview without the Decision Log, `decisionRows` its rows, and
 * `omitDecisionLog` leaves the part out entirely, the way a pass recorded before
 * the part existed leaves it.
 */
export const inputsFor = ({
	planFiles,
	sha256,
	probe = 'both',
	design = 'design-1',
	decisionRows = [],
	omitDecisionLog = false,
}: {
	planFiles: { file: string; sha256: string }[];
	sha256: string;
	probe?: 'both' | 'no-commit' | 'no-changed-files';
	design?: string;
	decisionRows?: GradeDecisionLog['rows'];
	omitDecisionLog?: boolean;
}): GradeInputs => ({
	planFiles,
	...(probe === 'no-commit' ? {} : { gradedCommit: 'commit-abc' }),
	...(probe === 'no-changed-files' ? {} : { changedFiles: [{ path: 'src/core.ts', sha256: 'code-1' }] }),
	standards: 'standards-1',
	config: 'config-1',
	prompts: 'prompts-1',
	model: 'opus',
	effort: 'high',
	...(omitDecisionLog ? {} : { decisionLog: { overview: design, rows: decisionRows } }),
	sha256,
});

/** One memory record. Only `status` and `phase` are read by the scope rules; the rest is what the contract demands of any record. */
export const findingRecord = ({
	id,
	phase,
	status,
	disposition = GapOutcome.NeedsAHuman,
}: {
	id: string;
	phase: string;
	status: GradeFindingStatus;
	disposition?: typeof GapOutcome.NeedsAHuman | typeof GapOutcome.AgentCanDecide | typeof GapOutcome.AlreadyAnswered;
}): GradeFindingRecord => ({
	id,
	phase,
	area: GapArea.OmittedDecision,
	gap: 'The plan never says which store the token is read from.',
	decision: 'Name the store the token is read from.',
	options: ['the keychain', 'an environment variable'],
	firstSeen: passAt,
	lastSeen: passAt,
	status,
	disposition,
	humanDecision: 'Pick the store.',
	reopened: [],
});

/** The persisted memory, with the two baselines a test can supply one at a time. */
export const memoryFor = ({
	findings,
	lastPass,
	lastPassingFullReview,
}: {
	findings: GradeFindingRecord[];
	lastPass?: GradeInputs;
	lastPassingFullReview?: GradeInputs;
}): GradeMemory => ({
	planName: 'demo',
	findings,
	...(lastPass === undefined ? {} : { lastPass: { scope: GradeScope.Full, inputs: lastPass, at: passAt } }),
	...(lastPassingFullReview === undefined ? {} : { lastPassingFullReview: { inputs: lastPassingFullReview, at: passAt } }),
	nextFindingNumber: findings.length + 1,
	updatedAt: passAt,
});

/** The two phase files a phased fixture uses: the first creates the shared file, the second modifies it. */
export const phasedFiles = (): { path: string; text: string }[] => [
	{ path: '/plans/demo/phase1-core.md', text: phaseBody({ create: ['src/core.ts'], handsForward: '- `src/core.ts` exists.' }) },
	{ path: '/plans/demo/phase2-extra.md', text: phaseBody({ prerequisites: '- `src/core.ts` exists.', modify: ['src/core.ts'] }) },
];

/** The plan-file hashes of a phased fixture; the first phase's hash and the overview's are the two a test moves. */
export const phasedPlanFiles = ({ phaseOne, overview = 'overview-1' }: { phaseOne: string; overview?: string }): { file: string; sha256: string }[] => [
	{ file: 'overview.md', sha256: overview },
	{ file: 'phase1-core.md', sha256: phaseOne },
	{ file: 'phase2-extra.md', sha256: 'phase2-1' },
];

/** The third phase file, which shares no path, export or hand-off with the two above it — what keeps a focused closure short of the whole plan. */
export const soloPhaseFile = (): { path: string; text: string } => ({ path: '/plans/demo/phase3-solo.md', text: phaseBody({ create: ['src/solo.ts'] }) });
