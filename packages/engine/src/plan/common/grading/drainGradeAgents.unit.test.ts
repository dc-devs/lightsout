import { basename, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import {
	type ConfigDocs,
	GapArea,
	type GapBatchVerdict,
	GapCheckLens,
	type GapObservation,
	GapOutcome,
	type GradedGap,
	type GradeFindingRecord,
	GradeFindingStatus,
	type GradeMemory,
} from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { drainGradeAgents } from '#src/plan/common/grading/drainGradeAgents.ts';
import type { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';
import { emptyDecisionsRecord } from '#tests/helpers/emptyDecisionsRecord.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { gapCheckLensOf } from '#tests/helpers/gapCheckLensOf.ts';

/** Each plan file's text carries a sentence no other file does, so a reader's prompt names the file it was spawned for. */
const firstPhaseText = '# Phase 1\n\nThe reader marker for phase one.\n';
const secondPhaseText = '# Phase 2\n\nThe reader marker for phase two.\n';

/** The one finding a reader reports: the decisions lens, on the first plan file only. */
const readerGap = { area: GapArea.OmittedDecision, gap: 'the retry limit is never chosen', decision: 'choose a retry limit', options: [] };

/** The pending record's finding, worded so it shares no distinctive word with the reader's. */
const carriedGapText = 'the rollback owner was never settled';

/** Prose with no JSON object in it — what a reader returns when it never answers on contract. */
const offContractProse = 'the plan looks fine to me';

/** Which plan file a reader was spawned for, read from the plan text its prompt carries. */
const phaseOf = ({ prompt }: DriverInvocation) => (prompt.includes(firstPhaseText) ? 'phase-1-reader.md' : 'phase-2-judge.md');

/** The pending record's one observation, at the second plan file. */
const carriedObservation: GapObservation = {
	phase: 'phase-2-judge.md',
	lens: GapCheckLens.Decisions,
	area: GapArea.OmittedDecision,
	gap: carriedGapText,
	decision: 'name the rollback owner',
	options: [],
};

/** A record no judge settled on an earlier pass: no disposition, and the reason nobody did. */
const pendingRecord: GradeFindingRecord = {
	id: 'f1',
	...carriedObservation,
	firstSeen: '2026-01-01T00:00:00.000Z',
	lastSeen: '2026-01-01T00:00:00.000Z',
	status: GradeFindingStatus.Pending,
	unjudgedReason: 'the judge timed out on the earlier pass',
	reopened: [],
	observations: [carriedObservation],
	resolutions: [],
};

/** The pending record re-offered as the finding it still is: its record id, its identity and its observations, stamped unjudged. */
const carriedGap: GradedGap = {
	...carriedObservation,
	outcome: GapOutcome.Unjudged,
	unjudgedReason: 'the judge timed out on the earlier pass',
	findingId: 'f1',
	observations: [carriedObservation],
};

/**
 * A grade stub keyed on the two markers this stage spawns with. A reader gets
 * the one finding when it is the decisions lens on the first plan file and
 * nothing otherwise — unless it is the failing reader, which answers off
 * contract every time, re-emits included. A judge answers with one single
 * `needs-a-human` ruling per engine identifier its prompt names, so it rules
 * whatever batches the engine assembled, in whatever order they start.
 */
const createGradeDriver = ({
	failingReader,
	invocations,
}: {
	failingReader?: { phase: string; lens: GapCheckLens };
	invocations: DriverInvocation[];
}): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		if (invocation.prompt.includes('# Gap-judge input')) {
			const ids = [...new Set(invocation.prompt.match(/\bo\d+\b/g) ?? [])];
			const verdict: GapBatchVerdict = {
				verdicts: ids.map((id) => ({ outcome: GapOutcome.NeedsAHuman, humanDecision: 'what the plan should do here', covers: [id], answers: [] })),
			};

			return { text: JSON.stringify(verdict), exitCode: 0 };
		}

		const failing =
			failingReader !== undefined &&
			(invocation.prompt.includes('# Validation error') || (phaseOf(invocation) === failingReader.phase && gapCheckLensOf(invocation) === failingReader.lens));

		if (failing) {
			return { text: offContractProse, exitCode: 0 };
		}

		const finds = phaseOf(invocation) === 'phase-1-reader.md' && gapCheckLensOf(invocation) === GapCheckLens.Decisions;

		return { text: JSON.stringify({ gaps: finds ? [readerGap] : [] }), exitCode: 0 };
	},
});

/** A two-file plan, both files heavy unless a case names fewer, graded with no documentation check, over a memory holding the given records. */
const setupGradeAgents = async ({
	findings = [],
	carried = [],
	failingReader,
	heavyPhases = ['phase-1-reader.md', 'phase-2-judge.md'],
}: {
	findings?: GradeFindingRecord[];
	carried?: GradedGap[];
	failingReader?: { phase: string; lens: GapCheckLens };
	/** The plan files weighed heavy enough to be read — the rest are weighed light and offered to no reader. */
	heavyPhases?: string[];
} = {}) => {
	const cwd = await freshCwd();
	const invocations: DriverInvocation[] = [];
	const files = [
		{ path: join(cwd, 'phase-1-reader.md'), text: firstPhaseText },
		{ path: join(cwd, 'phase-2-judge.md'), text: secondPhaseText },
	];
	const pass: Awaited<ReturnType<typeof getPlanDetectionPass>> = {
		files,
		planPaths: files.map((file) => file.path),
		decisions: emptyDecisionsRecord(),
		workspaceDir: cwd,
	};
	const memory: GradeMemory = { planName: 'demo', findings, coverage: { readers: [] }, nextFindingNumber: 2, updatedAt: '2026-01-01T00:00:00.000Z' };

	return {
		invocations,
		params: {
			params: { cwd, driver: createGradeDriver({ failingReader, invocations }), name: 'demo' },
			pass,
			selected: files.filter((file) => heavyPhases.includes(basename(file.path))),
			carried,
			memory,
			documentation: false,
			progress: () => undefined,
		},
	};
};

/** The surfaces a declaring repository writes — without them the documentation checker cannot spawn at all. */
const declaredDocs: ConfigDocs = [
	{ path: 'README.md', covers: 'The product tour.' },
	{ path: 'docs/configuration.md', covers: 'Every configuration key.' },
];

/** A driver that answers every spawn with an empty gap report, collecting what it was handed. */
const createQuietDriver = ({ invocations }: { invocations: DriverInvocation[] }): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		return { text: JSON.stringify({ gaps: [] }), exitCode: 0 };
	},
});

/** A five-file plan whose repository declares documentation surfaces, graded over a selection of two. */
const setupDocumentationPass = async ({ documentation }: { documentation: boolean }) => {
	const cwd = await freshCwd();
	const invocations: DriverInvocation[] = [];
	const files = [1, 2, 3, 4, 5].map((number) => ({
		path: join(cwd, `phase-${number}.md`),
		text: `# Phase ${number}\n\nThe reader marker for phase ${number}.\n`,
	}));
	const pass: Awaited<ReturnType<typeof getPlanDetectionPass>> = {
		files,
		planPaths: files.map((file) => file.path),
		decisions: emptyDecisionsRecord(),
		workspaceDir: cwd,
		config: { gates: { check: 'pnpm check', test: 'pnpm test:unit', 'test-coverage': 'pnpm test:coverage' }, docs: declaredDocs },
	};
	const memory: GradeMemory = { planName: 'demo', findings: [], coverage: { readers: [] }, nextFindingNumber: 1, updatedAt: '2026-01-01T00:00:00.000Z' };

	return {
		invocations,
		params: {
			params: { cwd, driver: createQuietDriver({ invocations }), name: 'demo' },
			pass,
			selected: files.slice(0, 2),
			carried: [],
			memory,
			documentation,
			progress: () => undefined,
		},
	};
};

describe('drainGradeAgents', () => {
	test("offers every pending record to the judge stage beside the readers' findings", async () => {
		const { params, invocations } = await setupGradeAgents({ findings: [pendingRecord], carried: [carriedGap] });

		const result = await drainGradeAgents(params);

		// a finding no judge settled last pass is judged again rather than lost, and
		// it keeps its record id so it attaches to its own record instead of opening a second
		const judgePrompts = invocations.filter((invocation) => invocation.prompt.includes('# Gap-judge input')).map((invocation) => invocation.prompt);
		expect({ offered: judgePrompts.some((prompt) => prompt.includes(carriedGapText)), gaps: result.gaps }).toEqual({
			offered: true,
			gaps: [
				expect.objectContaining({ phase: 'phase-1-reader.md', gap: readerGap.gap, outcome: GapOutcome.NeedsAHuman }),
				expect.objectContaining({ phase: 'phase-2-judge.md', gap: carriedGapText, findingId: 'f1', outcome: GapOutcome.NeedsAHuman }),
			],
		});
	});

	test('keeps every lens spawned per plan file and every-lens coverage unchanged', async () => {
		const { params, invocations } = await setupGradeAgents({ failingReader: { phase: 'phase-2-judge.md', lens: GapCheckLens.Wiring } });

		const result = await drainGradeAgents(params);

		// batching the judge stage changes nothing upstream of it: every file still
		// gets all three lenses, and a file whose wiring reader never answered is
		// not claimed as checked
		const readerSpawns = [
			...new Set(
				invocations
					.filter((invocation) => invocation.prompt.includes('# Gap-check input'))
					.map((invocation) => `${phaseOf(invocation)}/${gapCheckLensOf(invocation)}`),
			),
		].sort();
		expect({ readerSpawns, phasesChecked: result.phasesChecked }).toStrictEqual({
			readerSpawns: [
				'phase-1-reader.md/decisions',
				'phase-1-reader.md/surface',
				'phase-1-reader.md/wiring',
				'phase-2-judge.md/decisions',
				'phase-2-judge.md/surface',
				'phase-2-judge.md/wiring',
			],
			phasesChecked: ['phase-1-reader.md'],
		});
	});

	test('reports every lens that returned for a file even when a sibling lens failed', async () => {
		const { params } = await setupGradeAgents({ failingReader: { phase: 'phase-2-judge.md', lens: GapCheckLens.Wiring } });

		const result = await drainGradeAgents(params);

		// coverage is recorded per plan file AND brief, so the two briefs that did
		// return for phase two keep the reading they were paid for — while the file
		// itself is still not claimed as checked, because one brief never answered
		const read = result.read.map(({ phase, lens }) => `${phase}/${lens}`).sort();
		expect({ read, phasesChecked: result.phasesChecked }).toStrictEqual({
			read: ['phase-1-reader.md/decisions', 'phase-1-reader.md/surface', 'phase-1-reader.md/wiring', 'phase-2-judge.md/decisions', 'phase-2-judge.md/surface'],
			phasesChecked: ['phase-1-reader.md'],
		});
	});

	test("spawns the documentation checker from its own record rather than from the pass's scope", async () => {
		const { params, invocations } = await setupDocumentationPass({ documentation: true });

		const result = await drainGradeAgents(params);

		// the checker keys on its own coverage record rather than on how far the
		// pass reached, so a pass reading two of the plan's five files still runs it
		const docsSpawns = invocations.filter((invocation) => invocation.prompt.includes('# Docs-check input')).length;
		expect({
			docsSpawns,
			phasesChecked: result.phasesChecked,
			planFiles: params.pass.files.length,
			documentationComplete: result.documentationComplete,
		}).toStrictEqual({
			docsSpawns: 1,
			phasesChecked: ['phase-1.md', 'phase-2.md'],
			planFiles: 5,
			documentationComplete: true,
		});
	});

	test('a standing documentation record buys no spawn and still leaves the pass scope-complete', async () => {
		const { params, invocations } = await setupDocumentationPass({ documentation: false });

		const result = await drainGradeAgents(params);

		// a record that still stands is not bought a second time, and a pass with
		// nothing to ask the checker is not reported as one that failed to run it
		const docsSpawns = invocations.filter((invocation) => invocation.prompt.includes('# Docs-check input')).length;
		expect({ docsSpawns, documentationComplete: result.documentationComplete, failures: result.failures }).toStrictEqual({
			docsSpawns: 0,
			documentationComplete: true,
			failures: [],
		});
	});

	test('judges a carried record whose plan file no reader was offered this pass', async () => {
		const { params, invocations } = await setupGradeAgents({ findings: [pendingRecord], carried: [carriedGap], heavyPhases: ['phase-1-reader.md'] });

		const result = await drainGradeAgents(params);

		// phase two was weighed light, so nobody reads it — but the judge stage is
		// handed every plan file, so the carried record still meets a judge holding
		// its file's text instead of blocking forever with no path to a ruling; and
		// the reader's own finding arrives holding no observations of its own
		const readerPhases = [...new Set(invocations.filter((invocation) => invocation.prompt.includes('# Gap-check input')).map(phaseOf))];
		const carriedJudge = invocations.find((invocation) => invocation.prompt.includes('# Gap-judge input') && invocation.prompt.includes(carriedGapText));
		expect({
			readerPhases,
			carriedJudgeReadsItsFile: carriedJudge?.prompt.includes(secondPhaseText),
			phasesChecked: result.phasesChecked,
			gaps: result.gaps,
		}).toEqual({
			readerPhases: ['phase-1-reader.md'],
			carriedJudgeReadsItsFile: true,
			phasesChecked: ['phase-1-reader.md'],
			gaps: [
				expect.objectContaining({ phase: 'phase-1-reader.md', gap: readerGap.gap, outcome: GapOutcome.NeedsAHuman, observations: [] }),
				expect.objectContaining({ phase: 'phase-2-judge.md', gap: carriedGapText, findingId: 'f1', outcome: GapOutcome.NeedsAHuman }),
			],
		});
	});
});
