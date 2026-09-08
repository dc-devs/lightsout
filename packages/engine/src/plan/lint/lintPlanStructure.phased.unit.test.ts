import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { decisionLogReference, renderDecisionLog } from '#src/plan/decisionLog/index.ts';
import { lintPlanStructure } from '#src/plan/lint/lintPlanStructure.ts';
import { emptyDecisionsRecord } from '#tests/helpers/emptyDecisionsRecord.ts';
import { overviewBody, phaseBody } from '#tests/helpers/phasePlan.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** The full table an overview carries, and the pointer sentence a phase file carries instead — the two sections the shared body helpers already render. */
const decisionLogTable = renderDecisionLog({ decisions: [] });
const decisionLogPointer = decisionLogReference();

/** A consumer repo holding the given plan files, handed to the lint in the order they are written. */
const setupDeliverable = ({ files }: { files: Record<string, string> }) => {
	const cwd = setupConsumerRepo();
	const dir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(dir, { recursive: true });

	const planPaths = Object.entries(files).map(([name, body]) => {
		const path = join(dir, name);

		writeFileSync(path, body);

		return path;
	});

	return { cwd, planPaths };
};

describe('lintPlanStructure for a phased deliverable', () => {
	test('a phase may modify a file an earlier phase creates, under the heading that says so', async () => {
		const { cwd, planPaths } = setupDeliverable({
			files: {
				'phase1-core.md': phaseBody({ create: ['src/core.ts'] }),
				'phase2-extra.md': phaseBody({ earlierModify: ['src/core.ts'] }),
			},
		});

		const findings = await lintPlanStructure({ cwd, planPaths, decisions: emptyDecisionsRecord() });

		// the file is absent from disk today and present in the finished repo —
		// reading it as a broken reference would refuse every phased plan, got:
		// ${JSON.stringify(findings)}
		expect(findings).toStrictEqual([]);
	});

	test('the same file under Files to Modify is pointed at the earlier-phase heading instead', async () => {
		const { cwd, planPaths } = setupDeliverable({
			files: {
				'phase1-core.md': phaseBody({ create: ['src/core.ts'] }),
				'phase2-extra.md': phaseBody({ modify: ['src/core.ts'] }),
			},
		});

		const findings = await lintPlanStructure({ cwd, planPaths, decisions: emptyDecisionsRecord() });

		// Files to Modify means "exists on disk today", and the implementing agent
		// reads it that way — only the cross-phase pass can tell the two apart
		expect(findings.map(({ check, severity, phase, issue }) => ({ check, severity, phase, issue }))).toStrictEqual([
			{
				check: StructuralCheck.FileProvenance,
				severity: FindingSeverity.Blocking,
				phase: 'phase2-extra.md',
				issue: 'this file does not exist yet — an earlier phase creates it',
			},
		]);
		expect(findings[0]?.fix).toBe('list it under `## Files to Modify from Earlier Phases`');
	});

	test('the walk follows the phase number rather than the order the files arrive', async () => {
		const { cwd, planPaths } = setupDeliverable({
			files: {
				'phase10-late.md': phaseBody({ earlierModify: ['src/base.ts'] }),
				'phase2-base.md': phaseBody({ create: ['src/base.ts'] }),
			},
		});

		const findings = await lintPlanStructure({ cwd, planPaths, decisions: emptyDecisionsRecord() });

		// phase 10 runs after phase 2, however the folder listed them, got:
		// ${JSON.stringify(findings)}
		expect(findings).toStrictEqual([]);
	});

	test('a phase may not modify a file only a later phase creates', async () => {
		const { cwd, planPaths } = setupDeliverable({
			files: {
				'phase1-core.md': phaseBody({ modify: ['src/later.ts'] }),
				'phase2-extra.md': phaseBody({ create: ['src/later.ts'] }),
			},
		});

		const findings = await lintPlanStructure({ cwd, planPaths, decisions: emptyDecisionsRecord() });

		// only STRICTLY earlier phases supply anything: an out-of-order reference
		// is exactly the defect the provenance walk exists to catch
		expect(findings.map(({ check, severity, phase, issue }) => ({ check, severity, phase, issue }))).toStrictEqual([
			{
				check: StructuralCheck.PathExists,
				severity: FindingSeverity.Blocking,
				phase: 'phase1-core.md',
				issue: 'referenced path does not exist: src/later.ts',
			},
		]);
	});

	test('an overview beside a single phase is enough to make the deliverable phased, so a delete is answered by the cross-phase pass', async () => {
		const { cwd, planPaths } = setupDeliverable({
			files: {
				'overview.md': overviewBody({ rows: [{ number: 1, file: 'phase1-core.md', scope: 'the core', touched: 1 }] }),
				'phase1-core.md': phaseBody({ remove: ['src/gone.ts'] }),
			},
		});

		const findings = await lintPlanStructure({ cwd, planPaths, decisions: emptyDecisionsRecord() });

		// the per-file check leaves a phased delete alone because the file may be
		// one an earlier phase creates — here none does, and the cross-phase pass
		// is what can say so
		expect(findings.map(({ check, severity, phase, issue }) => ({ check, severity, phase, issue }))).toStrictEqual([
			{
				check: StructuralCheck.FileProvenance,
				severity: FindingSeverity.Blocking,
				phase: 'phase1-core.md',
				issue: 'nothing supplies this path: it is not on disk and no earlier phase creates it',
			},
		]);
	});

	test('a single plan has no predecessor, so the file it deletes has to be there today', async () => {
		const { cwd, planPaths } = setupDeliverable({ files: { 'plan.md': phaseBody({ remove: ['src/gone.ts'], reference: false }) } });

		const findings = await lintPlanStructure({ cwd, planPaths, decisions: emptyDecisionsRecord() });

		expect(findings.map(({ check, phase, issue }) => ({ check, phase, issue }))).toStrictEqual([
			{ check: StructuralCheck.PathExists, phase: 'plan.md', issue: 'referenced path does not exist: src/gone.ts' },
		]);
	});

	test('every finding names the plan file it came from', async () => {
		const { cwd, planPaths } = setupDeliverable({
			files: { 'phase1-core.md': phaseBody(), 'phase2-extra.md': phaseBody({ note: 'TBD — decide the shape later.' }) },
		});

		const findings = await lintPlanStructure({ cwd, planPaths, decisions: emptyDecisionsRecord() });

		// a twenty-finding phased run is only navigable if each row says which file
		// to open
		expect(findings.map(({ check, phase }) => ({ check, phase }))).toStrictEqual([{ check: StructuralCheck.NoPlaceholders, phase: 'phase2-extra.md' }]);
		expect(findings[0]?.location).toMatch(/^phase2-extra\.md:\d+$/);
	});

	test('a create path an earlier phase deletes is recreation, not a collision with the file on disk', async () => {
		const { cwd, planPaths } = setupDeliverable({
			files: { 'phase1-drop.md': phaseBody({ remove: ['src/index.js'] }), 'phase2-remake.md': phaseBody({ create: ['src/index.js'] }) },
		});

		const findings = await lintPlanStructure({ cwd, planPaths, decisions: emptyDecisionsRecord() });

		// the per-file check stats disk and sees the file standing there; only the
		// cross-phase pass knows phase 1 takes it away first, got:
		// ${JSON.stringify(findings)}
		expect(findings).toStrictEqual([]);
	});

	test('a create path no phase removes is still reported as already on disk', async () => {
		const { cwd, planPaths } = setupDeliverable({
			files: { 'phase1-core.md': phaseBody(), 'phase2-remake.md': phaseBody({ create: ['src/index.js'] }) },
		});

		const findings = await lintPlanStructure({ cwd, planPaths, decisions: emptyDecisionsRecord() });

		// the suppression is one-directional and narrow — without a preceding
		// removal the finding stands
		expect(findings.map(({ check, phase, issue }) => ({ check, phase, issue }))).toStrictEqual([
			{ check: StructuralCheck.PathExists, phase: 'phase2-remake.md', issue: 'Files to Create path already exists: src/index.js' },
		]);
	});

	test('a verification command may name a package script an earlier phase declares it adds', async () => {
		const { cwd, planPaths } = setupDeliverable({
			files: {
				'overview.md': overviewBody({
					rows: [
						{ number: 1, file: 'phase1-core.md', scripts: ['check:new'] },
						{ number: 2, file: 'phase2-extra.md' },
					],
				}),
				'phase1-core.md': phaseBody({ commands: ['true', 'check:new'] }),
				'phase2-extra.md': phaseBody({ commands: ['pnpm check:new'] }),
			},
		});

		const findings = await lintPlanStructure({ cwd, planPaths, decisions: emptyDecisionsRecord() });

		// no package.json has the script yet and none can until the plan is
		// implemented — the declaration is what makes it resolvable, got:
		// ${JSON.stringify(findings)}
		expect(findings).toStrictEqual([]);
	});

	test('a script only a later phase declares is not yet available to an earlier one', async () => {
		const { cwd, planPaths } = setupDeliverable({
			files: {
				'overview.md': overviewBody({
					rows: [
						{ number: 1, file: 'phase1-core.md' },
						{ number: 2, file: 'phase2-extra.md', scripts: ['check:new'] },
					],
				}),
				'phase1-core.md': phaseBody({ commands: ['pnpm check:new'] }),
				'phase2-extra.md': phaseBody({ commands: ['true', 'check:new'] }),
			},
		});

		const findings = await lintPlanStructure({ cwd, planPaths, decisions: emptyDecisionsRecord() });

		// the running set is earlier-or-same, so phase 1 verifying with phase 2's
		// script would fail the moment phase 1 is implemented
		expect(findings.map(({ check, phase }) => ({ check, phase }))).toStrictEqual([{ check: StructuralCheck.ScriptExists, phase: 'phase1-core.md' }]);
		expect(findings[0]?.issue).toMatch(/'check:new' which is not in any target package.json/);
	});

	test("the overview's declared counts are held against what the phase file actually lists", async () => {
		const { cwd, planPaths } = setupDeliverable({
			files: {
				'overview.md': overviewBody({ rows: [{ number: 1, file: 'phase1-core.md', created: 0, touched: 0 }] }),
				'phase1-core.md': phaseBody({ create: ['src/core.ts'] }),
			},
		});

		const findings = await lintPlanStructure({ cwd, planPaths, decisions: emptyDecisionsRecord() });

		// the lint counts each file once and hands the same two numbers to the
		// declaration check, so a stale overview cannot read as clean
		expect(findings.map(({ check, phase }) => ({ check, phase }))).toStrictEqual([
			{ check: StructuralCheck.DeclarationConsistent, phase: 'overview.md' },
			{ check: StructuralCheck.DeclarationConsistent, phase: 'overview.md' },
		]);
		expect(findings.map((finding) => finding.issue)).toStrictEqual([
			'phase1-core.md is declared to creates 0 source files, but its own file lists 1',
			'phase1-core.md is declared to touches 0 source files, but its own file lists 1',
		]);
	});

	test('lintPlanStructure: a phased plan wants the table on the overview and the pointer on every phase', async () => {
		const { cwd, planPaths } = setupDeliverable({
			files: {
				'overview.md': overviewBody({
					rows: [
						{ number: 1, file: 'phase1-core.md' },
						{ number: 2, file: 'phase2-extra.md' },
					],
				}).replace(decisionLogTable, decisionLogPointer),
				'phase1-core.md': phaseBody(),
				'phase2-extra.md': phaseBody().replace(decisionLogPointer, decisionLogTable),
			},
		});

		const findings = await lintPlanStructure({ cwd, planPaths, decisions: emptyDecisionsRecord() });

		// the two swapped files are the only ones reported: phase1-core.md keeps the
		// pointer the helper renders and raises nothing, which is what says the
		// demand differs by file kind rather than being one section for everybody,
		// got: ${JSON.stringify(findings)}
		expect(findings.map(({ check, severity, phase }) => ({ check, severity, phase }))).toStrictEqual([
			{ check: StructuralCheck.DecisionLogCurrent, severity: FindingSeverity.Blocking, phase: 'overview.md' },
			{ check: StructuralCheck.DecisionLogCurrent, severity: FindingSeverity.Blocking, phase: 'phase2-extra.md' },
		]);
		expect(findings.map(({ location }) => location)).toEqual([expect.stringMatching(/^overview\.md:\d+$/), expect.stringMatching(/^phase2-extra\.md:\d+$/)]);
		expect(findings.map(({ fix }) => fix)).toEqual([expect.stringContaining('plan sync-decisions'), expect.stringContaining('plan sync-decisions')]);
	});
});
