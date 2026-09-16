import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { importPlanningWorkspace } from '#src/plan/workflow/store/index.ts';
import { planningLegacyFixture } from '#tests/helpers/planningStoreFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async ({ missingPhase = false }: { missingPhase?: boolean } = {}) => {
	const context = await planningLegacyFixture();
	directories.push(context.cwd);
	if (missingPhase)
		context.inputs.legacyDecisions[0].content = JSON.stringify({ planName: context.name, decisions: [{ ...context.rows[0], phases: ['unknown.md'] }] });
	return context;
};

describe('importPlanningWorkspace', () => {
	test('archives actual coordinator inputs including future phases before replacement projections', async () => {
		const { cwd, name, inputs, files, runRoot, manifest } = await setup();

		const snapshot = await importPlanningWorkspace({ cwd, name, inputs });

		const registry = JSON.parse(snapshot.artifacts.get('planning-legacy-runs.json') ?? '{}');
		expect(registry.format).toBe('legacy-run-inputs-v1');
		expect(
			registry.entries.map((entry: { runId: string; files: { path: string; artifact: string }[] }) => ({
				runId: entry.runId,
				files: entry.files.map((file) => ({ path: file.path, content: snapshot.artifacts.get(file.artifact) })),
			})),
		).toStrictEqual([{ runId: 'coordinator', files: files.map((file) => ({ path: `.lightsout/plans/${name}/${file.path}`, content: file.text })) }]);
		expect(await readFile(join(runRoot, 'manifest.json'), 'utf8')).toBe(manifest);
		expect(snapshot.artifacts.get('phase2-next.md')).toBe('Replacement phase2-next.md');
	});
	test('captures phase identity and exact original decision row without adding approval', async () => {
		const { cwd, name, inputs, decisions } = await setup();

		const snapshot = await importPlanningWorkspace({ cwd, name, inputs });

		const settlement = snapshot.record.legacySettlements?.[0];
		expect(settlement?.phaseBindings).toStrictEqual([{ name: 'phase2-next.md', phaseId: 'stable-2' }]);
		expect(settlement?.scope).toStrictEqual({ kind: 'selected', claimIds: [], phaseIds: ['stable-2'], packageRoots: [] });
		expect(snapshot.artifacts.get(settlement?.artifact ?? '')).toBe(decisions);
		expect(snapshot.record.confirmations).toStrictEqual([]);
		expect(snapshot.record.reviewReceipts).toStrictEqual([]);
	});
	test('keeps unknown historical phase scope conservative without inventing a mapping', async () => {
		const { cwd, name, inputs, scope } = await setup({ missingPhase: true });

		const snapshot = await importPlanningWorkspace({ cwd, name, inputs });

		expect(snapshot.record.legacySettlements?.map(({ phaseBindings, scope }) => ({ phaseBindings, scope }))).toStrictEqual([
			{ phaseBindings: [{ name: 'unknown.md', phaseId: null }], scope },
		]);
	});
});

const setupFindings = async () => {
	const context = await setup();
	const rows = [
		{ id: 'resolved', status: 'resolved', humanDecision: 'Use existing idempotency key' },
		{ id: 'open', status: 'open' },
		{ id: 'retired', status: 'superseded' },
	].map((item) => ({
		...item,
		phase: 'phase2-next.md',
		area: 'underspecified-surface',
		gap: 'Retry duplicates a write',
		decision: 'Specify identity',
		firstSeen: 'earlier',
		lastSeen: 'earlier',
	}));
	const content = JSON.stringify({ planName: context.name, findings: rows, updatedAt: 'earlier' }, null, 2);
	return { ...context, rows, content, inputs: { ...context.inputs, legacyFindings: { path: 'grade-memory.json', content } } };
};
test('preserves historical answers as repair context without manufacturing verification', async () => {
	const { cwd, name, inputs, content, rows } = await setupFindings();

	const snapshot = await importPlanningWorkspace({ cwd, name, inputs });

	expect(
		snapshot.record.findings.map((finding) => ({
			id: finding.id,
			state: finding.state,
			answer: finding.proposedResolution,
			verified: finding.verificationReceiptIds,
		})),
	).toStrictEqual([
		{ id: 'legacy-finding:resolved', state: 'repairing', answer: 'Use existing idempotency key', verified: [] },
		{ id: 'legacy-finding:open', state: 'open', answer: undefined, verified: [] },
	]);
	expect(snapshot.artifacts.get('grade-memory.json')).toBe(content);
	expect(snapshot.record.findings.map((finding) => JSON.parse(snapshot.artifacts.get(finding.citations[0].artifact) ?? '{}'))).toStrictEqual(rows.slice(0, 2));
});

const setupObservedFinding = async () => {
	const context = await setupFindings();
	const first = context.rows[0];
	const observation = { phase: first.phase, area: first.area, gap: first.gap, decision: first.decision, options: ['Reuse existing identity'] };
	const row = {
		...first,
		observations: [observation, { ...observation, phase: 'phase1-first.md', gap: 'Earlier work retries the same write' }],
		resolutions: [{ phase: first.phase, answerAt: 'Retry contract section', verifiedAt: 'earlier' }],
	};
	const content = JSON.stringify({ planName: context.name, findings: [row], updatedAt: 'earlier' });
	return { ...context, row, inputs: { ...context.inputs, legacyFindings: { path: 'grade-memory.json', content } } };
};
test('retains every historical observation and per-phase answer location', async () => {
	const { cwd, name, inputs, row } = await setupObservedFinding();

	const snapshot = await importPlanningWorkspace({ cwd, name, inputs });

	const finding = snapshot.record.findings[0];
	expect(finding.observationIds).toHaveLength(2);
	expect(new Set(finding.observationIds).size).toBe(2);
	expect(JSON.parse(snapshot.artifacts.get(finding.citations[0].artifact) ?? '{}')).toStrictEqual(row);
	expect(finding.proposedResolution).toBe('Use existing idempotency key\nphase2-next.md: Retry contract section');
	expect(finding.verificationReceiptIds).toStrictEqual([]);
});
