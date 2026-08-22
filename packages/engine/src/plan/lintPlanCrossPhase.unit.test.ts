import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { getPhaseProvenance, lintPlanCrossPhase } from '#src/plan/index.ts';
import { type DeclarationSpec, overviewBody, type PhaseSpec, phaseBody, phaseFile } from '#tests/helpers/phasePlan.ts';

/** The pass as `lintPlanStructure` calls it: an empty repo, the phases parsed and resolved, and the counts it computed once. */
const setupDeliverable = ({ specs, rows }: { specs: { base: string; spec?: PhaseSpec }[]; rows?: DeclarationSpec[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-cross-phase-'));
	const phases = specs.map(({ base, spec }) => phaseFile({ base, body: phaseBody(spec), dir: cwd }));
	const counts = new Map<string, { created: number; touched: number }>(phases.map((phase) => [phase.base, { created: 0, touched: 0 }]));
	const overview = rows === undefined ? undefined : phaseFile({ base: 'overview.md', body: overviewBody({ rows }), dir: cwd });

	return { cwd, overview, phases, counts, provenance: getPhaseProvenance({ phases }) };
};

describe('lintPlanCrossPhase', () => {
	test('a single plan with no overview has no phase boundary to be inconsistent across', async () => {
		const { cwd, overview, phases, provenance, counts } = setupDeliverable({ specs: [{ base: 'plan.md', spec: { remove: ['src/never-existed.ts'] } }] });

		const result = await lintPlanCrossPhase({ cwd, overview, phases, provenance, counts });

		// the delete is unsupplied, and the per-file check is what judges it — this
		// pass has nothing to say about a plan with no siblings
		expect(result).toStrictEqual({ findings: [], clearedCreates: new Set() });
	});

	test('two phases without an overview still get provenance and hand-off checks', async () => {
		const { cwd, overview, phases, provenance, counts } = setupDeliverable({
			specs: [
				{ base: 'phase1-core.md', spec: { create: ['src/core.ts'], handsForward: '- `buildCore` exists.' } },
				{ base: 'phase2-extra.md', spec: { modify: ['src/core.ts'] } },
			],
		});

		const { findings } = await lintPlanCrossPhase({ cwd, overview, phases, provenance, counts });

		expect(findings.map(({ check, phase }) => ({ check, phase }))).toStrictEqual([
			{ check: StructuralCheck.FileProvenance, phase: 'phase2-extra.md' },
			{ check: StructuralCheck.HandoffChained, phase: 'phase2-extra.md' },
		]);
	});

	test('an overview adds the declaration check the phase files alone cannot run', async () => {
		const { cwd, overview, phases, provenance, counts } = setupDeliverable({
			specs: [{ base: 'phase1-core.md' }],
			rows: [
				{ number: 1, file: 'phase1-core.md' },
				{ number: 2, file: 'phase2-ghost.md' },
			],
		});

		const { findings } = await lintPlanCrossPhase({ cwd, overview, phases, provenance, counts });

		// an overview beside one phase file is still a phased deliverable
		expect(findings.map(({ check, phase, issue }) => ({ check, phase, issue }))).toStrictEqual([
			{
				check: StructuralCheck.DeclarationConsistent,
				phase: 'overview.md',
				issue: "the phase breakdown declares 'phase2-ghost.md', which is not one of this plan's phase files",
			},
		]);
	});

	test('the cleared creates come straight from the provenance pass', async () => {
		const { cwd, overview, phases, provenance, counts } = setupDeliverable({
			specs: [
				{ base: 'phase1-core.md', spec: { create: ['src/cycle.ts'] } },
				{ base: 'phase2-drop.md', spec: { remove: ['src/cycle.ts'] } },
				{ base: 'phase3-again.md', spec: { create: ['src/cycle.ts'] } },
			],
		});

		const result = await lintPlanCrossPhase({ cwd, overview, phases, provenance, counts });

		// no other check contributes to the set, and this pass never rewrites it
		expect(result).toStrictEqual({ findings: [], clearedCreates: new Set(['phase3-again.md|src/cycle.ts']) });
	});

	test('a nine-phase breakdown raises the advisory note and nothing blocking', async () => {
		const specs = Array.from({ length: 9 }, (_, index) => ({ base: `phase${index + 1}-step.md` }));
		const rows = specs.map(({ base }, index) => ({ number: index + 1, file: base }));
		const { cwd, overview, phases, provenance, counts } = setupDeliverable({ specs, rows });

		const { findings } = await lintPlanCrossPhase({ cwd, overview, phases, provenance, counts });

		expect(findings.map(({ check, severity, phase }) => ({ check, severity, phase }))).toStrictEqual([
			{ check: StructuralCheck.PhaseCount, severity: FindingSeverity.Advisory, phase: 'overview.md' },
		]);
	});
});
