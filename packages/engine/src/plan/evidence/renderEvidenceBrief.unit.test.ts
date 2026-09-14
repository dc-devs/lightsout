import { describe, expect, test } from '@jest/globals';
import { type SourceEvidenceIndex, SourceEvidenceKind } from '#src/contracts/index.ts';
import { renderEvidenceBrief } from '#src/plan/evidence/index.ts';

/**
 * The collected record a writer's brief is assembled from. Every entry is a
 * complete `SourceEvidenceEntry`; a test states only the fields its criterion
 * turns on.
 */
const setupIndex = ({ entries = [] }: { entries?: Partial<SourceEvidenceIndex['entries'][number]>[] } = {}) => {
	const index: SourceEvidenceIndex = {
		planName: 'focused-plan-drafting',
		collectedAt: '2026-09-13T00:00:00.000Z',
		entries: entries.map((overrides, position) => ({
			path: `packages/engine/src/plan/file${position + 1}.ts`,
			sha256: 'a'.repeat(64),
			kind: SourceEvidenceKind.Whole,
			bytes: 400,
			text: `export const file${position + 1} = () => {};\n`,
			roles: [`role ${position + 1}`],
			definitions: [],
			...overrides,
		})),
	};

	return { index };
};

/**
 * The brief split into one slice per requested path, cut at each path's own
 * mention and searched forward so a path quoted inside an earlier block's
 * evidence text cannot be mistaken for the start of its own block.
 */
const briefBlocks = ({ brief, paths }: { brief: string; paths: string[] }): string[] => {
	const starts: number[] = [];
	let cursor = 0;
	for (const path of paths) {
		const start = brief.indexOf(path, cursor);
		starts.push(start);
		cursor = start === -1 ? cursor : start + path.length;
	}

	return starts.map((start, position) => (start === -1 ? '' : brief.slice(start, starts[position + 1] ?? brief.length)));
};

/** The length of every run of backticks that opens a line, longest first. */
const fenceRuns = (brief: string): number[] =>
	brief
		.split('\n')
		.map((line) => /^(`+)/.exec(line)?.[1].length ?? 0)
		.filter((length) => length > 0)
		.sort((left, right) => right - left);

describe('renderEvidenceBrief', () => {
	test('renderEvidenceBrief: only the requested paths appear, in the requested order, with their recorded roles', () => {
		const { index } = setupIndex({
			entries: [
				{ path: 'packages/engine/src/plan/draft/runPlanDraft.ts', roles: ['the dispatcher the focused flow is selected from'] },
				{
					path: 'packages/engine/src/plan/detectPriorArtCandidates.ts',
					roles: ['the census this phase extracts', 'integration point: detectPriorArtCandidates'],
				},
				{ path: 'packages/engine/src/agents/buildPlanWriterInvocation/buildPlanWriterInvocation.ts', roles: ["legacy's invocation builder"] },
			],
		});

		const brief = renderEvidenceBrief({
			index,
			paths: ['packages/engine/src/plan/detectPriorArtCandidates.ts', 'packages/engine/src/plan/draft/runPlanDraft.ts'],
		});

		// the requested order is the order the assignment wants to read them in,
		// and the third entry belongs to another assignment: handing it over is the
		// per-phase re-reading this whole module exists to stop
		expect(brief.indexOf('packages/engine/src/plan/detectPriorArtCandidates.ts')).toBeLessThan(brief.indexOf('packages/engine/src/plan/draft/runPlanDraft.ts'));
		expect(brief).not.toContain('buildPlanWriterInvocation');
		// the roles are the facts' own words for why the file matters — a block
		// that drops them hands over source with no reason to read it
		const [census, dispatcher] = briefBlocks({
			brief,
			paths: ['packages/engine/src/plan/detectPriorArtCandidates.ts', 'packages/engine/src/plan/draft/runPlanDraft.ts'],
		});
		expect(census).toContain('the census this phase extracts');
		expect(census).toContain('integration point: detectPriorArtCandidates');
		expect(dispatcher).toContain('the dispatcher the focused flow is selected from');
	});

	test('renderEvidenceBrief: a fence inside the evidence text cannot break out of its block', () => {
		const evidence = [
			'/**',
			' * ```ts',
			" * const brief = renderEvidenceBrief({ index, paths: ['a.ts'] });",
			' * ```',
			' */',
			'export const documented = () => {};',
			'',
		].join('\n');
		const { index } = setupIndex({ entries: [{ path: 'packages/engine/src/plan/evidence/documented.ts', text: evidence }] });

		const brief = renderEvidenceBrief({ index, paths: ['packages/engine/src/plan/evidence/documented.ts'] });

		// the evidence arrives whole, and the fence wrapping it is longer than the
		// three-backtick run inside it — a three-backtick wrapper would end the
		// block at the docblock and spill the rest of the file into the prompt as
		// instructions to the writer
		const runs = fenceRuns(brief);
		expect(brief).toContain(evidence);
		expect(runs.filter((length) => length > 3).length).toBeGreaterThanOrEqual(2);
	});

	test('renderEvidenceBrief: a reduced entry says the file was reduced and that the writer may open it', () => {
		const { index } = setupIndex({
			entries: [
				{
					path: 'packages/engine/src/plan/detectPriorArtCandidates.ts',
					kind: SourceEvidenceKind.Definitions,
					bytes: 19004,
					text: 'export const detectPriorArtCandidates = async () => [];\nconst getNameKey = () => "";\n',
					definitions: ['detectPriorArtCandidates', 'getNameKey'],
				},
			],
		});

		const brief = renderEvidenceBrief({ index, paths: ['packages/engine/src/plan/detectPriorArtCandidates.ts'] });

		// a writer that reads a reduced block as the whole file will plan against a
		// file it has only seen part of, so the block has to say the size limit it
		// passed, name what survived, and say the rest is one read away
		expect(brief).toMatch(/12,?000/);
		expect(brief).toContain('detectPriorArtCandidates');
		expect(brief).toContain('getNameKey');
		expect(brief).toMatch(/open/i);
	});

	test('renderEvidenceBrief: an absent file and an uncollected path are stated differently', () => {
		const { index } = setupIndex({
			entries: [
				{ path: 'packages/engine/src/plan/gone.ts', kind: SourceEvidenceKind.Missing, sha256: '', bytes: 0, text: '', roles: ['integration point: gone'] },
			],
		});

		const brief = renderEvidenceBrief({ index, paths: ['packages/engine/src/plan/gone.ts', 'packages/engine/src/plan/neverAsked.ts'] });

		const [absent, uncollected] = briefBlocks({ brief, paths: ['packages/engine/src/plan/gone.ts', 'packages/engine/src/plan/neverAsked.ts'] });
		// "the facts named it and it is not there" is a fact about the repository a
		// writer must plan around; "nothing was collected for it" is a fact about
		// this record, which the writer answers by opening the file. Reading the
		// first as the second is how a writer plans against a file that is gone
		expect(absent).toMatch(/disk/i);
		expect(uncollected).not.toMatch(/disk/i);
		expect(uncollected).toMatch(/collected/i);
	});

	test('renderEvidenceBrief: an entry the facts recorded no role for says so beside its evidence', () => {
		const { index } = setupIndex({ entries: [{ path: 'packages/engine/src/plan/unexplained.ts', roles: [] }] });

		const brief = renderEvidenceBrief({ index, paths: ['packages/engine/src/plan/unexplained.ts'] });

		// a block that silently omits the role line hands over source with nothing
		// saying why it is there, which reads as a file the writer may ignore
		expect(brief).toMatch(/no role/i);
		expect(brief).toContain('export const file1 = () => {};');
	});

	test('renderEvidenceBrief: no requested paths renders nothing', () => {
		const { index } = setupIndex({ entries: [{ path: 'packages/engine/src/plan/draft/runPlanDraft.ts' }] });

		const brief = renderEvidenceBrief({ index, paths: [] });

		// an empty section heading in a prompt reads as "there is no evidence for
		// any of this", which is a different claim from "this spawn needs none"
		expect(brief).toBe('');
	});
});
