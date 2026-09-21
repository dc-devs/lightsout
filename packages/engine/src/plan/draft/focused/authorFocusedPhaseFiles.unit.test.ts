import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import {
	type DecisionsRecord,
	type ExploreArea,
	type PlanFacts,
	PlanVariant,
	type SourceEvidenceEntry,
	type SourceEvidenceIndex,
	SourceEvidenceKind,
} from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import { authorFocusedPhaseFiles } from '#src/plan/draft/focused/authorFocusedPhaseFiles.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';

const decisions: DecisionsRecord = { planName: 'demo', decisions: [] };

/**
 * The environment a focused plan-writer spawn is meant to reach the harness in,
 * spelled out here rather than imported: a test comparing the request to itself
 * would pass however the request changed.
 *
 * The fan-out is where most of a phased draft's spend goes, so a phase writer
 * left unrestricted is the one place the saving silently stops applying. Matched
 * whole, which is what rejects a tool the role never asked for and a model,
 * effort or permission smuggled into the request.
 */
const focusedRequest = {
	noMcpServers: true,
	noSkillCatalog: true,
	toolAllowlist: true,
	settingsPreserved: true,
	tools: ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
};

/** One explorer area carrying only the recorded locations a case needs; every other field is the empty answer. */
const exploreArea = ({
	area,
	filesToModify = [],
	patternsToMirror = [],
}: { area: string } & Partial<Pick<ExploreArea, 'filesToModify' | 'patternsToMirror'>>): ExploreArea => ({
	area,
	affectedPackages: [],
	filesToModify,
	patternsToMirror,
	integrationPoints: [],
	scripts: [],
	namingConvention: 'camelCase',
});

/** The verified facts a fan-out is handed, over whichever areas a case declares. */
const factsFor = ({ areas }: { areas: ExploreArea[] }): PlanFacts => ({
	request: 'do a thing',
	areas,
	verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [] },
	verifiedAt: '2026-01-01T00:00:00.000Z',
});

/** One whole-file evidence entry, its text carrying a sentinel that appears nowhere in any path. */
const evidenceEntry = ({ path, sentinel }: { path: string; sentinel: string }): SourceEvidenceEntry => ({
	path,
	sha256: `sha-${sentinel}`,
	kind: SourceEvidenceKind.Whole,
	bytes: 64,
	text: `export const collected = (): string => '${sentinel}';\n`,
	roles: ['why the facts named it'],
	definitions: [],
});

/** One overview row, defaulted to a phase that declares nothing across its boundary. */
const declarationFor = ({ number, ...overrides }: Partial<PhaseDeclaration> & { number: number }): PhaseDeclaration => ({
	number,
	file: `phase${number}-step.md`,
	scope: 'the work',
	createdCount: 1,
	touchedCount: 1,
	creates: [],
	exports: [],
	scripts: [],
	...overrides,
});

/** The plan-writer's drafted report for one phase file. */
const draftedReport = ({ path }: { path: string }) =>
	JSON.stringify({
		status: 'drafted',
		filesWritten: [{ path, variant: PlanVariant.Phase, scope: basename(path) }],
		decisionsApplied: 0,
		assumptions: [],
		discrepancies: [],
	});

/**
 * A focused phase-writer stub: it streams one event so its step's transcript
 * lands, authors the one file the engine dictated in its prompt, and reports it.
 * It records how many spawns were in flight at once, which is what a bound can
 * be read off.
 *
 * `writes: false` makes it report the file without ever writing it — the agent
 * that claims work it did not do.
 */
const focusedPhaseDriver = ({
	invocations,
	inFlight,
	writes = true,
}: {
	invocations: DriverInvocation[];
	inFlight: { peak: number };
	writes?: boolean;
}): Driver => {
	let live = 0;

	return {
		name: 'stub',
		invoke: async (invocation) => {
			live += 1;
			inFlight.peak = Math.max(inFlight.peak, live);
			invocations.push(invocation);
			invocation.onEvent?.({ spawned: invocations.length });

			// let every other slot claim its task before this one answers, so the
			// recorded peak is the fan-out's real width rather than one at a time
			await new Promise((resolve) => setImmediate(resolve));

			const path = /- (\S+\.md) — variant:/.exec(invocation.prompt)?.[1];

			// the engine dictates exactly one output path per phase spawn
			expectDefined(path);

			if (writes) {
				writeFileSync(path, `# ${basename(path)}\n`);
			}

			live -= 1;

			return { text: draftedReport({ path }), exitCode: 0 };
		},
	};
};

interface SetupParams {
	declarations: PhaseDeclaration[];
	/** Explorer areas the evidence entries were taken from. */
	areas?: ExploreArea[];
	/** The draft's collected evidence, handed in whole for the fan-out to narrow. */
	entries?: SourceEvidenceEntry[];
	/** Repo-relative path → contents, written into the temp repo so the export census can see them. */
	repoFiles?: Record<string, string>;
	/** Whether each phase spawn actually writes the file it reports. */
	writes?: boolean;
}

/** A temp repository with a plan workspace, plus the arguments the focused fan-out takes, ready for one act. */
const setupFocusedFanOut = ({ declarations, areas = [], entries = [], repoFiles = {}, writes = true }: SetupParams) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-focused-phases-'));
	const workspaceDir = join(cwd, '.lightsout', 'tickets', 'demo', 'plans');

	mkdirSync(workspaceDir, { recursive: true });

	for (const [path, contents] of Object.entries(repoFiles)) {
		mkdirSync(join(cwd, dirname(path)), { recursive: true });
		writeFileSync(join(cwd, path), contents);
	}

	const invocations: DriverInvocation[] = [];
	const inFlight = { peak: 0 };
	const messages: string[] = [];
	const evidence: SourceEvidenceIndex = { planName: 'demo', entries, collectedAt: '2026-01-01T00:00:00.000Z' };

	return {
		cwd,
		workspaceDir,
		invocations,
		inFlight,
		messages,
		params: {
			cwd,
			driver: focusedPhaseDriver({ invocations, inFlight, writes }),
			name: 'demo',
			workspaceDir,
			facts: factsFor({ areas }),
			decisions,
			overviewText: '# Demo — Overview\n',
			declarations,
			evidence,
			executorFileLimit: 50,
			timeoutMs: 60_000,
			progress: (message: string) => messages.push(message),
		},
	};
};

/**
 * The step transcripts a fan-out left behind, once every one of them has landed.
 * The sink appends through a promise tail nothing awaits — by design, so a slow
 * disk never stalls a harness read loop — so the files trail the spawns.
 */
const readTranscriptNames = async ({ workspaceDir, count }: { workspaceDir: string; count: number }) => {
	for (let attempt = 1; attempt <= 100; attempt += 1) {
		const names = readdirSync(workspaceDir)
			.filter((name) => name.endsWith('-stream.jsonl'))
			.sort();

		if (names.length >= count) {
			return names;
		}

		await new Promise((resolve) => setTimeout(resolve, 5));
	}

	throw new Error(`only ${count} transcript(s) never landed in ${workspaceDir}`);
};

/** The prompt the spawn authoring one phase file was handed. */
const promptFor = ({ invocations, file }: { invocations: DriverInvocation[]; file: string }) => {
	const invocation = invocations.find(({ prompt }) => prompt.includes(`${file} — variant:`));

	expectDefined(invocation);

	return invocation.prompt;
};

describe('authorFocusedPhaseFiles', () => {
	test('fans out one focused writer per declaration under the existing bound', async () => {
		const { cwd, workspaceDir, params, invocations, inFlight, messages } = setupFocusedFanOut({
			declarations: [1, 2, 3].map((number) => declarationFor({ number })),
		});

		const result = await authorFocusedPhaseFiles(params);

		expectStatus(result, 'complete');

		const transcripts = await readTranscriptNames({ workspaceDir, count: 3 });

		// the declaration is what buys the concurrency, and the transcript names are
		// read by the manual draft comparison — renaming one breaks it silently
		expect({ spawns: invocations.length, withinBound: inFlight.peak <= 8, planPaths: result.planPaths, transcripts }).toStrictEqual({
			spawns: 3,
			withinBound: true,
			planPaths: [1, 2, 3].map((number) => join(cwd, '.lightsout', 'tickets', 'demo', 'plans', `phase${number}-step.md`)),
			transcripts: ['draft-phase1-stream.jsonl', 'draft-phase2-stream.jsonl', 'draft-phase3-stream.jsonl'],
		});
		expect(messages).toEqual(expect.arrayContaining([expect.stringContaining('authoring 3 phase file(s), up to 8 at a time')]));
	});

	test('gives each phase writer its own evidence and prior-art briefs', async () => {
		const { params, invocations } = setupFocusedFanOut({
			declarations: [
				declarationFor({ number: 1, file: 'phase1-alpha.md', creates: ['packages/demo/src/alpha/alphaNew.ts'], exports: ['alphaNew'] }),
				declarationFor({ number: 2, file: 'phase2-beta.md', creates: ['packages/demo/src/beta/betaNew.ts'], exports: ['renderWidget'] }),
			],
			areas: [
				exploreArea({
					area: 'the alpha surface',
					filesToModify: [{ path: 'packages/demo/src/alpha/alphaSource.ts', role: 'the alpha surface' }],
					patternsToMirror: [{ path: 'packages/demo/src/alpha/alphaMirror.ts', takeaway: 'how alpha is shaped' }],
				}),
				exploreArea({
					area: 'the beta surface',
					filesToModify: [{ path: 'packages/demo/src/beta/betaSource.ts', role: 'the beta surface' }],
				}),
			],
			entries: [
				evidenceEntry({ path: 'packages/demo/src/alpha/alphaSource.ts', sentinel: 'alpha-body-sentinel' }),
				evidenceEntry({ path: 'packages/demo/src/alpha/alphaMirror.ts', sentinel: 'mirror-body-sentinel' }),
				evidenceEntry({ path: 'packages/demo/src/beta/betaSource.ts', sentinel: 'beta-body-sentinel' }),
			],
			repoFiles: { 'packages/demo/src/widgets/renderWidget.ts': "export const renderWidget = (): string => 'widget';\n" },
		});

		const result = await authorFocusedPhaseFiles(params);

		expectStatus(result, 'complete');

		const alpha = promptFor({ invocations, file: 'phase1-alpha.md' });
		const beta = promptFor({ invocations, file: 'phase2-beta.md' });

		// a writer reads the evidence for the files its own work touches, never the
		// union of every phase's — and a reference pattern is what it is being asked
		// to imitate, so it rides every spawn whatever that spawn creates
		expect({
			alpha: ['alpha-body-sentinel', 'beta-body-sentinel', 'mirror-body-sentinel'].map((sentinel) => alpha.includes(sentinel)),
			beta: ['alpha-body-sentinel', 'beta-body-sentinel', 'mirror-body-sentinel'].map((sentinel) => beta.includes(sentinel)),
		}).toStrictEqual({ alpha: [true, false, true], beta: [false, true, true] });
		// every spawn is told what the census found for its own declared symbols; a
		// clean result is a finding, so the section is there either way
		expect({
			census: [alpha, beta].map((prompt) => prompt.includes('## Prior art census')),
			collision: [alpha, beta].map((prompt) => prompt.includes('packages/demo/src/widgets/renderWidget.ts')),
		}).toStrictEqual({ census: [true, true], collision: [false, true] });
		expect(beta).toContain('`renderWidget` — already answered by:');
	});

	test('requests the focused environment on every phase spawn alike', async () => {
		const { params, invocations } = setupFocusedFanOut({ declarations: [1, 2].map((number) => declarationFor({ number })) });

		const result = await authorFocusedPhaseFiles(params);

		expectStatus(result, 'complete');
		expect(invocations.map(({ environment }) => environment)).toStrictEqual([focusedRequest, focusedRequest]);
	});

	test('a phase claiming a file it never wrote fails the fan-out, naming that path', async () => {
		const { cwd, params } = setupFocusedFanOut({ declarations: [declarationFor({ number: 1 })], writes: false });

		const result = await authorFocusedPhaseFiles(params);

		expectStatus(result, 'failed');
		// the engine verifies the write rather than trusting the report, so a
		// claimed-but-absent phase file ends the draft here instead of reaching
		// whatever reads the deliverable next
		expect(result.error).toContain(join(cwd, '.lightsout', 'tickets', 'demo', 'plans', 'phase1-step.md'));
	});
});
