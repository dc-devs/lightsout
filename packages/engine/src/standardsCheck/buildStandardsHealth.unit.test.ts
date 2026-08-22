import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type AdvisoryOutcome, type BatchReport, type RefactorBatch, type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import { buildStandardsHealth } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPack, LoadedStandardsRule } from '#src/standardsPacks/index.ts';

const rule = (overrides: Partial<LoadedStandardsRule> & { id: string }): LoadedStandardsRule => ({
	set: 'code',
	documentPath: 'code/architecture/folder-structure',
	summary: 'a rule',
	prose: 'the argument for the rule',
	channel: 'base',
	checked: false,
	defaultSeverity: StandardsSeverity.Advisory,
	defaultSettings: {},
	fixturesPath: `/packages/acme/${overrides.id}/fixtures`,
	...overrides,
});

const packOf = ({ name = 'acme', rules }: { name?: string; rules: LoadedStandardsRule[] }): LoadedStandardsPack => ({
	name,
	formatVersion: 1,
	rootPath: `/packages/${name}`,
	documents: [],
	rules,
});

const finding = ({ rule: ruleId, path }: { rule: string; path: string }): StandardsFinding => ({
	rule: ruleId,
	severity: StandardsSeverity.Blocking,
	siteKey: `${ruleId}:${path}`,
	files: [{ path }],
	detail: 'a site',
});

const batch = ({ id, blocking }: { id: string; blocking: StandardsFinding[] }): RefactorBatch => ({
	id,
	rule: blocking[0]?.rule ?? 'unknown',
	folder: 'src',
	blocking,
	advisories: [],
});

interface RunSpec {
	runId?: string;
	/** `null` writes a manifest with no `pipeline` field at all — how runs from before the discriminator existed are stored. */
	pipeline?: string | null;
	batches: RefactorBatch[];
	reports?: Record<string, unknown>;
	worklistJson?: string;
	/** Raw manifest text, for the run whose manifest cannot be read at all. */
	manifestJson?: string;
	/** Batch ids the manifest holds no step record for — how a run stopped before a batch ran is stored. */
	unrecordedBatchIds?: string[];
}

/**
 * A repo with one persisted run: a frozen work-list plus the manifest step
 * records that answered it. `pipeline` and `plan` are what decide whether the
 * report treats the run as its material at all.
 */
const setupRun = ({
	cwd = mkdtempSync(join(tmpdir(), 'lightsout-health-')),
	runId = 'run-01',
	pipeline = 'refactor',
	batches,
	reports = {},
	worklistJson,
	manifestJson,
	unrecordedBatchIds = [],
}: RunSpec & { cwd?: string }) => {
	const runDir = join(cwd, '.lightsout', 'runs', runId);

	mkdirSync(runDir, { recursive: true });
	writeFileSync(join(runDir, 'worklist.json'), worklistJson ?? JSON.stringify({ at: '2026-01-01T00:00:00.000Z', path: '.', all: false, batches }));
	writeFileSync(
		join(runDir, 'manifest.json'),
		manifestJson ??
			JSON.stringify({
				runId,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
				plan: join('.lightsout', 'runs', runId, 'worklist.json'),
				...(pipeline === null ? {} : { pipeline }),
				harness: 'stub',
				status: 'passed',
				currentStep: null,
				steps: batches
					.filter((entry) => !unrecordedBatchIds.includes(entry.id))
					.map((entry) => ({
						id: entry.id,
						status: 'passed',
						attempts: 1,
						...(Object.hasOwn(reports, entry.id) ? { report: reports[entry.id] } : {}),
					})),
				changedFiles: [],
			}),
	);

	return cwd;
};

/** A repo holding several persisted runs, written in the order given. */
const setupRuns = ({ runs }: { runs: RunSpec[] }) => runs.reduce((cwd, run) => setupRun({ ...run, cwd }), mkdtempSync(join(tmpdir(), 'lightsout-health-')));

const report = (overrides: Partial<BatchReport> = {}): BatchReport => ({
	outcome: 'declined',
	remainingSiteKeys: [],
	rationale: [],
	...overrides,
});

const advice = (overrides: Partial<AdvisoryOutcome> & { rule: string; siteKey: string }): AdvisoryOutcome => ({
	outcome: 'applied',
	...overrides,
});

/** The health row for one rule — the report is sorted by id, not indexed by it. */
const rowFor = ({ rules, id }: { rules: Awaited<ReturnType<typeof buildStandardsHealth>>['rules']; id: string }) => rules.find((entry) => entry.id === id);

describe('buildStandardsHealth', () => {
	test('coverage is counted off the package folders, so it lands with no run history at all', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-health-empty-'));

		const health = await buildStandardsHealth({
			cwd,
			packs: [packOf({ rules: [rule({ id: 'multi-export', checked: true }), rule({ id: 'path-aliases' })] })],
		});

		expect(health.totals).toStrictEqual({ rules: 2, checked: 1, judgment: 1 });
		// sorted by id, so the report diffs cleanly between runs
		expect(health.rules.map((entry) => entry.id)).toStrictEqual(['multi-export', 'path-aliases']);
		expect(rowFor({ rules: health.rules, id: 'multi-export' })).toEqual(
			expect.objectContaining({ attempted: 0, resolved: 0, declined: 0, untracked: 0, adviceApplied: 0, adviceDeclined: 0, reasons: [] }),
		);
	});

	test('a site the batch report shows gone is resolved; one still standing in a declined batch is declined', async () => {
		const cwd = setupRun({
			batches: [
				batch({ id: 'batch-01', blocking: [finding({ rule: 'multi-export', path: 'src/a.ts' }), finding({ rule: 'multi-export', path: 'src/b.ts' })] }),
			],
			reports: {
				'batch-01': report({ outcome: 'declined', remainingSiteKeys: ['multi-export:src/b.ts'], rationale: ['[plan] splitting would break the barrel'] }),
			},
		});

		const health = await buildStandardsHealth({ cwd, packs: [packOf({ rules: [rule({ id: 'multi-export', checked: true })] })] });

		expect(rowFor({ rules: health.rules, id: 'multi-export' })).toEqual(
			expect.objectContaining({ attempted: 2, resolved: 1, declined: 1, untracked: 0, reasons: ['[plan] splitting would break the barrel'] }),
		);
	});

	test('a site left standing in a resolved batch is untracked — only a decline is a decline', async () => {
		const cwd = setupRun({
			batches: [batch({ id: 'batch-01', blocking: [finding({ rule: 'multi-export', path: 'src/a.ts' })] })],
			reports: { 'batch-01': report({ outcome: 'resolved', remainingSiteKeys: ['multi-export:src/a.ts'], rationale: [] }) },
		});

		const health = await buildStandardsHealth({ cwd, packs: [packOf({ rules: [rule({ id: 'multi-export', checked: true })] })] });

		expect(rowFor({ rules: health.rules, id: 'multi-export' })).toEqual(expect.objectContaining({ attempted: 1, resolved: 0, declined: 0, untracked: 1 }));
	});

	test('a batch with no parseable report is attempted only — a failed batch is not a decline', async () => {
		const cwd = setupRun({ batches: [batch({ id: 'batch-01', blocking: [finding({ rule: 'multi-export', path: 'src/a.ts' })] })] });

		const health = await buildStandardsHealth({ cwd, packs: [packOf({ rules: [rule({ id: 'multi-export', checked: true })] })] });

		expect(rowFor({ rules: health.rules, id: 'multi-export' })).toEqual(expect.objectContaining({ attempted: 1, resolved: 0, declined: 0, untracked: 1 }));
	});

	test('a batch’s rationale attaches to every rule it left a site standing for', async () => {
		const cwd = setupRun({
			batches: [
				batch({
					id: 'batch-01',
					blocking: [finding({ rule: 'multi-export', path: 'src/a.ts' }), finding({ rule: 'module-boundary', path: 'src/b.ts' })],
				}),
			],
			reports: {
				'batch-01': report({
					outcome: 'declined',
					remainingSiteKeys: ['multi-export:src/a.ts', 'module-boundary:src/b.ts'],
					rationale: ['[other] both are deliberate'],
				}),
			},
		});

		const health = await buildStandardsHealth({
			cwd,
			packs: [packOf({ rules: [rule({ id: 'multi-export', checked: true }), rule({ id: 'module-boundary', checked: true })] })],
		});

		// the rationale is recorded per batch, so both rules carry it
		expect(rowFor({ rules: health.rules, id: 'multi-export' })?.reasons).toStrictEqual(['[other] both are deliberate']);
		expect(rowFor({ rules: health.rules, id: 'module-boundary' })?.reasons).toStrictEqual(['[other] both are deliberate']);
	});

	test('an implement run is not this report’s material', async () => {
		const cwd = setupRun({
			pipeline: 'implement',
			batches: [batch({ id: 'batch-01', blocking: [finding({ rule: 'multi-export', path: 'src/a.ts' })] })],
			reports: { 'batch-01': report({ outcome: 'declined', remainingSiteKeys: ['multi-export:src/a.ts'] }) },
		});

		const health = await buildStandardsHealth({ cwd, packs: [packOf({ rules: [rule({ id: 'multi-export', checked: true })] })] });

		expect(rowFor({ rules: health.rules, id: 'multi-export' })).toEqual(expect.objectContaining({ attempted: 0, declined: 0 }));
	});

	test('a manifest written before the pipeline field existed reads as an implement run, so it is skipped too', async () => {
		const cwd = setupRun({
			pipeline: null,
			batches: [batch({ id: 'batch-01', blocking: [finding({ rule: 'multi-export', path: 'src/a.ts' })] })],
			reports: { 'batch-01': report({ outcome: 'declined', remainingSiteKeys: ['multi-export:src/a.ts'] }) },
		});

		const health = await buildStandardsHealth({ cwd, packs: [packOf({ rules: [rule({ id: 'multi-export', checked: true })] })] });

		expect(rowFor({ rules: health.rules, id: 'multi-export' })).toEqual(expect.objectContaining({ attempted: 0, declined: 0, untracked: 0 }));
	});

	test('a rule the run recorded but no loaded pack names gets no row — the packs decide what the report has rows for', async () => {
		const cwd = setupRun({
			batches: [batch({ id: 'batch-01', blocking: [finding({ rule: 'retired-rule', path: 'src/a.ts' })] })],
			reports: {
				'batch-01': report({
					outcome: 'declined',
					remainingSiteKeys: ['retired-rule:src/a.ts'],
					advisoryOutcomes: [advice({ rule: 'never-shipped', siteKey: 'never-shipped:src/a.ts', outcome: 'applied' })],
				}),
			},
		});

		const health = await buildStandardsHealth({ cwd, packs: [packOf({ rules: [rule({ id: 'multi-export', checked: true })] })] });

		expect(health.rules.map((entry) => entry.id)).toStrictEqual(['multi-export']);
		expect(health.totals).toStrictEqual({ rules: 1, checked: 1, judgment: 0 });
	});

	test('a run whose work-list will not parse is skipped, and the readable runs still count', async () => {
		const cwd = setupRuns({
			runs: [
				{
					runId: 'run-broken',
					batches: [batch({ id: 'batch-01', blocking: [finding({ rule: 'multi-export', path: 'src/a.ts' })] })],
					worklistJson: '{ not json at all',
				},
				{
					runId: 'run-good',
					batches: [batch({ id: 'batch-01', blocking: [finding({ rule: 'multi-export', path: 'src/b.ts' })] })],
					reports: { 'batch-01': report({ outcome: 'declined', remainingSiteKeys: ['multi-export:src/b.ts'], rationale: ['[other] deliberate'] }) },
				},
			],
		});

		const health = await buildStandardsHealth({ cwd, packs: [packOf({ rules: [rule({ id: 'multi-export', checked: true })] })] });

		// one corrupt run directory must not take the whole account down with it
		expect(rowFor({ rules: health.rules, id: 'multi-export' })).toEqual(expect.objectContaining({ attempted: 1, declined: 1 }));
	});

	test('a run whose manifest will not parse is skipped, and the readable runs still count', async () => {
		const cwd = setupRuns({
			runs: [
				{
					runId: 'run-broken',
					batches: [batch({ id: 'batch-01', blocking: [finding({ rule: 'multi-export', path: 'src/a.ts' })] })],
					manifestJson: '{ not json at all',
				},
				{
					runId: 'run-good',
					batches: [batch({ id: 'batch-01', blocking: [finding({ rule: 'multi-export', path: 'src/b.ts' })] })],
					reports: { 'batch-01': report({ outcome: 'resolved', remainingSiteKeys: [] }) },
				},
			],
		});

		const health = await buildStandardsHealth({ cwd, packs: [packOf({ rules: [rule({ id: 'multi-export', checked: true })] })] });

		expect(rowFor({ rules: health.rules, id: 'multi-export' })).toEqual(expect.objectContaining({ attempted: 1, resolved: 1, declined: 0, untracked: 0 }));
	});

	test('a batch the manifest holds no step record for is untracked — a batch that never ran judged nothing', async () => {
		const cwd = setupRun({
			batches: [batch({ id: 'batch-01', blocking: [finding({ rule: 'multi-export', path: 'src/a.ts' })] })],
			unrecordedBatchIds: ['batch-01'],
		});

		const health = await buildStandardsHealth({ cwd, packs: [packOf({ rules: [rule({ id: 'multi-export', checked: true })] })] });

		expect(rowFor({ rules: health.rules, id: 'multi-export' })).toEqual(expect.objectContaining({ attempted: 1, resolved: 0, declined: 0, untracked: 1 }));
	});

	test('one rule’s counts accumulate across every refactor run the repo has state for', async () => {
		const cwd = setupRuns({
			runs: [
				{
					runId: 'run-01',
					batches: [batch({ id: 'batch-01', blocking: [finding({ rule: 'multi-export', path: 'src/a.ts' })] })],
					reports: { 'batch-01': report({ outcome: 'resolved', remainingSiteKeys: [] }) },
				},
				{
					runId: 'run-02',
					batches: [batch({ id: 'batch-01', blocking: [finding({ rule: 'multi-export', path: 'src/b.ts' })] })],
					reports: {
						'batch-01': report({ outcome: 'declined', remainingSiteKeys: ['multi-export:src/b.ts'], rationale: ['[other] deliberate'] }),
					},
				},
			],
		});

		const health = await buildStandardsHealth({ cwd, packs: [packOf({ rules: [rule({ id: 'multi-export', checked: true })] })] });

		expect(rowFor({ rules: health.rules, id: 'multi-export' })).toEqual(
			expect.objectContaining({ attempted: 2, resolved: 1, declined: 1, untracked: 0, reasons: ['[other] deliberate'] }),
		);
	});

	test('every loaded pack contributes rows, sorted by id across the packs together', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-health-packs-'));

		const health = await buildStandardsHealth({
			cwd,
			packs: [packOf({ name: 'zeta', rules: [rule({ id: 'path-aliases' })] }), packOf({ name: 'alpha', rules: [rule({ id: 'multi-export', checked: true })] })],
		});

		expect(health.rules.map((entry) => entry.id)).toStrictEqual(['multi-export', 'path-aliases']);
		expect(health.totals).toStrictEqual({ rules: 2, checked: 1, judgment: 1 });
	});

	test('each batch is answered by the step record carrying its own id, not by position', async () => {
		const cwd = setupRun({
			batches: [
				batch({ id: 'batch-01', blocking: [finding({ rule: 'multi-export', path: 'src/a.ts' })] }),
				batch({ id: 'batch-02', blocking: [finding({ rule: 'module-boundary', path: 'src/b.ts' })] }),
			],
			reports: { 'batch-02': report({ outcome: 'resolved', remainingSiteKeys: [] }) },
			unrecordedBatchIds: ['batch-01'],
		});

		const health = await buildStandardsHealth({
			cwd,
			packs: [packOf({ rules: [rule({ id: 'multi-export', checked: true }), rule({ id: 'module-boundary', checked: true })] })],
		});

		expect(rowFor({ rules: health.rules, id: 'multi-export' })).toEqual(expect.objectContaining({ attempted: 1, resolved: 0, untracked: 1 }));
		expect(rowFor({ rules: health.rules, id: 'module-boundary' })).toEqual(expect.objectContaining({ attempted: 1, resolved: 1, untracked: 0 }));
	});
});
