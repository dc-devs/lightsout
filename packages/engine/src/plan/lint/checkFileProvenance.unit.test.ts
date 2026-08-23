import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import type { PhaseProvenance } from '#src/plan/common/types/PhaseProvenance.ts';
import { getPhaseProvenance } from '#src/plan/common/utils/getPhaseProvenance.ts';
import { checkFileProvenance } from '#src/plan/lint/checkFileProvenance.ts';
import { type PhaseSpec, phaseBody, phaseFile } from '#tests/helpers/phasePlan.ts';

/** A repo holding one real source file, and the given phases resolved into the provenance the lint hands this check. */
const setupPhases = ({ specs }: { specs: { base: string; spec?: PhaseSpec }[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-file-provenance-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/on-disk.ts'), 'export const onDisk = 1;\n');

	const phases = specs.map(({ base, spec }) => phaseFile({ base, body: phaseBody(spec), dir: cwd }));

	return { cwd, phases, provenance: getPhaseProvenance({ phases }) };
};

/** One phase against a provenance written by hand — the defaults every lookup falls back to when a map has no entry for it. */
const setupHandBuilt = ({ spec, provenance }: { spec: PhaseSpec; provenance: PhaseProvenance }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-file-provenance-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/on-disk.ts'), 'export const onDisk = 1;\n');

	const phases: PhaseFile[] = [phaseFile({ base: 'plan.md', body: phaseBody(spec), dir: cwd })];

	return { cwd, phases, provenance };
};

/** A provenance that knows nothing at all. */
const emptyProvenance = (): PhaseProvenance => ({
	providedBefore: new Map(),
	removedBefore: new Map(),
	createdBy: new Map(),
	removedBy: new Map(),
});

describe('checkFileProvenance', () => {
	test('a phase modifying an earlier phase creation under the heading that says so is silent', async () => {
		const { cwd, phases, provenance } = setupPhases({
			specs: [
				{ base: 'phase1-core.md', spec: { create: ['src/core.ts'] } },
				{ base: 'phase2-extra.md', spec: { earlierModify: ['src/core.ts'] } },
			],
		});

		const result = await checkFileProvenance({ cwd, phases, provenance });

		// nothing here is missing — phase 1 puts the file there, got:
		// ${JSON.stringify(result.findings)}
		expect(result).toStrictEqual({ findings: [], clearedCreates: new Set() });
	});

	test('a plain modify of a file an earlier phase creates is pointed at the earlier-phase heading', async () => {
		const { cwd, phases, provenance } = setupPhases({
			specs: [
				{ base: 'phase1-core.md', spec: { create: ['src/core.ts'] } },
				{ base: 'phase2-extra.md', spec: { modify: ['src/core.ts'] } },
			],
		});

		const { findings } = await checkFileProvenance({ cwd, phases, provenance });

		expect(findings).toStrictEqual([
			{
				check: StructuralCheck.FileProvenance,
				severity: FindingSeverity.Blocking,
				phase: 'phase2-extra.md',
				issue: 'this file does not exist yet — an earlier phase creates it',
				location: 'phase2-extra.md → src/core.ts',
				fix: 'list it under `## Files to Modify from Earlier Phases`',
			},
		]);
	});

	test('an earlier-phase modify of a path no earlier phase writes has nothing supplying it', async () => {
		const { cwd, phases, provenance } = setupPhases({
			specs: [{ base: 'phase1-core.md' }, { base: 'phase2-extra.md', spec: { earlierModify: ['src/never-written.ts'] } }],
		});

		const { findings } = await checkFileProvenance({ cwd, phases, provenance });

		expect(findings.map(({ phase, issue, fix }) => ({ phase, issue, fix }))).toStrictEqual([
			{
				phase: 'phase2-extra.md',
				issue: 'no earlier phase creates this path',
				fix: 'list it under `## Files to Modify` if it exists today, or have an earlier phase create it',
			},
		]);
	});

	test('a path an earlier phase deletes is gone by the time a later phase names it', async () => {
		const { cwd, phases, provenance } = setupPhases({
			specs: [
				{ base: 'phase1-drop.md', spec: { remove: ['src/on-disk.ts'] } },
				{ base: 'phase2-extra.md', spec: { modify: ['src/on-disk.ts'] } },
			],
		});

		const { findings } = await checkFileProvenance({ cwd, phases, provenance });

		// the file is on disk today, so only the walk can say it will not be there
		// when phase 2 runs
		expect(findings.map(({ phase, issue }) => ({ phase, issue }))).toStrictEqual([
			{ phase: 'phase2-extra.md', issue: 'path is gone by this phase: phase1-drop.md already deletes or moves it away' },
		]);
	});

	test('a delete naming a path that is neither on disk nor created by an earlier phase has nothing to remove', async () => {
		const { cwd, phases, provenance } = setupPhases({ specs: [{ base: 'plan.md', spec: { remove: ['src/never-existed.ts'] } }] });

		const { findings } = await checkFileProvenance({ cwd, phases, provenance });

		expect(findings.map(({ issue, location }) => ({ issue, location }))).toStrictEqual([
			{ issue: 'nothing supplies this path: it is not on disk and no earlier phase creates it', location: 'plan.md → src/never-existed.ts' },
		]);
	});

	test('a move whose source is on disk today needs no phase to supply it', async () => {
		const { cwd, phases, provenance } = setupPhases({
			specs: [{ base: 'plan.md', spec: { move: [{ from: 'src/on-disk.ts', to: 'src/moved.ts' }] } }],
		});

		const result = await checkFileProvenance({ cwd, phases, provenance });

		expect(result.findings).toStrictEqual([]);
	});

	test('two phases creating the same path collide', async () => {
		const { cwd, phases, provenance } = setupPhases({
			specs: [
				{ base: 'phase1-core.md', spec: { create: ['src/dup.ts'] } },
				{ base: 'phase2-extra.md', spec: { create: ['src/dup.ts'] } },
			],
		});

		const { findings } = await checkFileProvenance({ cwd, phases, provenance });

		expect(findings.map(({ phase, issue, fix }) => ({ phase, issue, fix }))).toStrictEqual([
			{
				phase: 'phase1-core.md',
				issue: 'two phases create this path: phase2-extra.md creates it too',
				fix: 'let one phase create it and have the other list it under `## Files to Modify from Earlier Phases`',
			},
		]);
	});

	test('a move destination is new ground too, so landing on another phase creation collides', async () => {
		const { cwd, phases, provenance } = setupPhases({
			specs: [
				{ base: 'phase1-core.md', spec: { create: ['src/dest.ts'] } },
				{ base: 'phase2-move.md', spec: { move: [{ from: 'src/on-disk.ts', to: 'src/dest.ts' }] } },
			],
		});

		const { findings } = await checkFileProvenance({ cwd, phases, provenance });

		expect(findings.map(({ phase, issue }) => ({ phase, issue }))).toStrictEqual([
			{ phase: 'phase1-core.md', issue: 'two phases create this path: phase2-move.md creates it too' },
		]);
	});

	test('deleting a file and recreating it later is legitimate work, and the recreate is cleared for the per-file check', async () => {
		const { cwd, phases, provenance } = setupPhases({
			specs: [
				{ base: 'phase1-core.md', spec: { create: ['src/cycle.ts'] } },
				{ base: 'phase2-drop.md', spec: { remove: ['src/cycle.ts'] } },
				{ base: 'phase3-again.md', spec: { create: ['src/cycle.ts'] } },
			],
		});

		const result = await checkFileProvenance({ cwd, phases, provenance });

		// no collision, because a removal falls between the two creates — and the
		// cleared key is what lets the per-file `path-exists` finding be dropped
		expect(result).toStrictEqual({ findings: [], clearedCreates: new Set(['phase3-again.md|src/cycle.ts']) });
	});

	test('a provenance holding no entry for a phase treats it as having no predecessor', async () => {
		const { cwd, phases, provenance } = setupHandBuilt({ spec: { remove: ['src/never-existed.ts'] }, provenance: emptyProvenance() });

		const { findings } = await checkFileProvenance({ cwd, phases, provenance });

		expect(findings.map((finding) => finding.issue)).toStrictEqual(['nothing supplies this path: it is not on disk and no earlier phase creates it']);
	});

	test('a removal with no recorded remover still says an earlier phase took the path away', async () => {
		const { cwd, phases, provenance } = setupHandBuilt({
			spec: { modify: ['src/on-disk.ts'] },
			provenance: { ...emptyProvenance(), removedBefore: new Map([['plan.md', new Set(['src/on-disk.ts'])]]) },
		});

		const { findings } = await checkFileProvenance({ cwd, phases, provenance });

		expect(findings.map((finding) => finding.issue)).toStrictEqual(['path is gone by this phase: an earlier phase already deletes or moves it away']);
	});
});
