import { describe, expect, test } from '@jest/globals';
import { PipelineKind, type RefactorBatch, type RunManifest, RunStatus, StandardsSeverity, type StepRecord } from '#src/contracts/index.ts';
import type { FrozenWorklist } from '#src/views/common/types/FrozenWorklist.ts';
import { buildRunBurnDown } from '#src/views/common/utils/buildRunBurnDown.ts';

/** One frozen batch, with as many blocking findings as the case asks for. */
const buildBatch = ({ id, rule = 'multi-export', blocking = 1 }: { id: string; rule?: string; blocking?: number }): RefactorBatch => ({
	id,
	rule,
	folder: 'packages/engine',
	blocking: Array.from({ length: blocking }, (_, index) => ({
		rule,
		siteKey: `${id}:${index}`,
		severity: StandardsSeverity.Blocking,
		files: [{ path: `packages/engine/src/${index}.ts` }],
		detail: 'a finding',
	})),
	advisories: [],
});

const buildManifest = ({ pipeline, steps = [] }: { pipeline: PipelineKind; steps?: StepRecord[] }): RunManifest => ({
	runId: 'run-burn-down',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T01:00:00.000Z',
	plan: '.lightsout/runs/run-burn-down/worklist.json',
	pipeline,
	harness: 'claude-code',
	status: RunStatus.Passed,
	currentStep: null,
	steps,
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
});

const frozen = ({ batches }: { batches: RefactorBatch[] }): FrozenWorklist => ({
	kind: PipelineKind.Refactor,
	worklist: { at: '2026-01-01T00:00:00.000Z', path: '.', all: false, batches },
});

describe('buildRunBurnDown', () => {
	test('a refactor run reports what its work-list froze against what its batches left standing', () => {
		const batches = [
			buildBatch({ id: 'batch-01:multi-export:engine', blocking: 3 }),
			buildBatch({ id: 'batch-02:size-file:engine', rule: 'size-file', blocking: 2 }),
		];
		const burnDown = buildRunBurnDown({
			manifest: buildManifest({
				pipeline: PipelineKind.Refactor,
				steps: [
					{ id: batches[0].id, status: RunStatus.Passed, attempts: 1, report: { outcome: 'resolved', remainingSiteKeys: [], rationale: [] } },
					{
						id: batches[1].id,
						status: RunStatus.Passed,
						attempts: 1,
						report: { outcome: 'declined', remainingSiteKeys: ['a', 'b'], rationale: ['splitting would hide the flow'] },
					},
				],
			}),
			worklist: frozen({ batches }),
		});

		expect(burnDown).toStrictEqual({
			before: 5,
			after: 2,
			batchesResolved: 1,
			batchesDeclined: 1,
			batches: [
				{ id: batches[0].id, rule: 'multi-export', folder: 'packages/engine', blocking: 3, outcome: 'resolved', rationale: [], advisoryOutcomes: [] },
				{
					id: batches[1].id,
					rule: 'size-file',
					folder: 'packages/engine',
					blocking: 2,
					outcome: 'declined',
					rationale: ['splitting would hide the flow'],
					advisoryOutcomes: [],
				},
			],
			// only the size and crowding rules — the sprawl story, measured
			overCap: { before: 2, after: 2 },
		});
	});

	test('a batch the run never reached counts its frozen findings as still standing', () => {
		const batches = [buildBatch({ id: 'batch-01:multi-export:engine', blocking: 4 }), buildBatch({ id: 'batch-02:multi-export:engine', blocking: 6 })];
		const burnDown = buildRunBurnDown({
			manifest: buildManifest({
				pipeline: PipelineKind.Refactor,
				steps: [{ id: batches[0].id, status: RunStatus.Passed, attempts: 1, report: { outcome: 'resolved', remainingSiteKeys: [], rationale: [] } }],
			}),
			worklist: frozen({ batches }),
		});

		// a run that stopped after the first of two reads as barely started
		expect(burnDown).toEqual(expect.objectContaining({ before: 10, after: 6, batchesResolved: 1, batchesDeclined: 0 }));
		expect(burnDown?.batches.map((batch) => batch.outcome)).toStrictEqual(['resolved', 'not-run']);
	});

	test('a batch whose recorded report will not parse is read as never run, not as resolved', () => {
		const batches = [buildBatch({ id: 'batch-01:multi-export:engine', blocking: 2 })];
		const burnDown = buildRunBurnDown({
			manifest: buildManifest({
				pipeline: PipelineKind.Refactor,
				steps: [{ id: batches[0].id, status: RunStatus.Failed, attempts: 1, report: { shape: 'nobody anticipated' } }],
			}),
			worklist: frozen({ batches }),
		});

		expect(burnDown).toEqual(expect.objectContaining({ before: 2, after: 2, batchesResolved: 0, batchesDeclined: 0 }));
	});

	test('the advisories a batch reported are carried whole, so the panel can show what was declined and why', () => {
		const batches = [buildBatch({ id: 'batch-01:multi-export:engine' })];
		const advisoryOutcomes = [{ rule: 'comment-narration', siteKey: 'src/a.ts:doThing', outcome: 'declined', reason: 'the comment states a billing rule' }];
		const burnDown = buildRunBurnDown({
			manifest: buildManifest({
				pipeline: PipelineKind.Refactor,
				steps: [
					{ id: batches[0].id, status: RunStatus.Passed, attempts: 1, report: { outcome: 'resolved', remainingSiteKeys: [], rationale: [], advisoryOutcomes } },
				],
			}),
			worklist: frozen({ batches }),
		});

		expect(burnDown?.batches[0].advisoryOutcomes).toStrictEqual(advisoryOutcomes);
	});

	test('a work-list holding no size or crowding batch reports no over-cap count rather than a pair of zeroes', () => {
		const batches = [buildBatch({ id: 'batch-01:multi-export:engine' })];
		const burnDown = buildRunBurnDown({ manifest: buildManifest({ pipeline: PipelineKind.Refactor }), worklist: frozen({ batches }) });

		expect(burnDown?.overCap).toBe(undefined);
	});

	test('a refactor run whose frozen work-list is missing or unparseable gets no panel at all', () => {
		// The tag survives a file that would not parse, which is exactly the case a
		// reader must not be shown zeroes for.
		const unparseable: FrozenWorklist = { kind: PipelineKind.Refactor, worklist: undefined };

		for (const worklist of [undefined, unparseable]) {
			expect(buildRunBurnDown({ manifest: buildManifest({ pipeline: PipelineKind.Refactor }), worklist })).toBe(undefined);
		}
	});

	test('a coverage run reports each file it measured, worst first, and counts no sites', () => {
		const burnDown = buildRunBurnDown({
			manifest: buildManifest({
				pipeline: PipelineKind.Coverage,
				steps: [
					{
						id: 'batch-01:coverage',
						status: RunStatus.Passed,
						attempts: 1,
						report: {
							outcome: 'resolved',
							rationale: [],
							files: [
								{ path: 'src/a.ts', beforePct: 40, afterPct: 70 },
								{ path: 'src/b.ts', beforePct: 10, afterPct: 12 },
							],
						},
					},
					{
						id: 'batch-02:coverage',
						status: RunStatus.Passed,
						attempts: 1,
						report: { outcome: 'resolved', rationale: [], files: [{ path: 'src/a.ts', beforePct: 70, afterPct: 96 }] },
					},
				],
			}),
			worklist: { kind: PipelineKind.Coverage, worklist: { at: '2026-01-01T00:00:00.000Z', totals: [], files: [] } },
		});

		// one merged row per path: the earliest reading against the latest
		expect(burnDown).toStrictEqual({
			batches: [],
			files: [
				{ path: 'src/b.ts', beforePct: 10, afterPct: 12 },
				{ path: 'src/a.ts', beforePct: 40, afterPct: 96 },
			],
		});
	});

	test('a coverage run none of whose steps recorded a measurement gets no panel', () => {
		const manifest = buildManifest({ pipeline: PipelineKind.Coverage, steps: [{ id: 'measure', status: RunStatus.Failed, attempts: 1 }] });

		expect(buildRunBurnDown({ manifest, worklist: undefined })).toBe(undefined);
	});

	test('an implement run burns nothing down, so it reports nothing', () => {
		expect(buildRunBurnDown({ manifest: buildManifest({ pipeline: PipelineKind.Implement }), worklist: undefined })).toBe(undefined);
	});
});
