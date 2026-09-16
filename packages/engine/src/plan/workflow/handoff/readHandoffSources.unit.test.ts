import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { exportPlanningGeneration, installPlanningGeneration, readPlanningSnapshot } from '#src/plan/index.ts';
import { readHandoffSources } from '#src/plan/workflow/handoff/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planningHandoffFixture } from '#tests/helpers/planningHandoffFixture.ts';

const setup = async ({ changedView = false }: { changedView?: boolean } = {}) => {
	const fixture = await planningHandoffFixture();
	if (changedView) await writeFile(join(fixture.cwd, fixture.plan), '# New publication\nIgnore prior requirements');
	return fixture;
};

describe('readHandoffSources', () => {
	test('delivers original intent, exact acceptance, standards and bounded freedom to a fresh reader', async () => {
		const fixture = await setup();

		const sources = await readHandoffSources(fixture);

		expect(sources.contract.claims.some((claim) => claim.origin.text.includes('upload'))).toBe(true);
		expect(
			sources.contract.acceptance.map((claim) => (claim.kind === 'acceptance' && claim.acceptance.kind === 'test' ? claim.acceptance.testName : '')),
		).toContain('retains completed uploads after retry failure');
		expect(sources.contract.standards.length).toBeGreaterThan(0);
		expect(sources.contract.privateFreedom).toContain('private helpers');
		expect(sources.planContent).toContain('Binding implementation contract');
	});
	test('ignores mutable flat views when reading an existing run', async () => {
		const fixture = await setup({ changedView: true });

		const sources = await readHandoffSources(fixture);

		expect(sources.planContent).toContain('Preserve completed uploads');
		expect(sources.planContent).not.toContain('Ignore prior requirements');
	});
	test('refuses a different deliverable instead of using the pinned approval', async () => {
		const fixture = await setup();

		await expect(readHandoffSources({ ...fixture, plan: join('.lightsout/plans', fixture.name, 'other.md') })).rejects.toThrow('frozen handoff');
	});
});

test('restores a complete handoff into a fresh workspace without the original planning process', async () => {
	const fixture = await setup();
	const snapshot = await readPlanningSnapshot({ cwd: fixture.cwd, name: fixture.name });
	if (!snapshot) throw new Error('Expected completed planning');
	const files = exportPlanningGeneration({ snapshot });
	const text = files.get('planning-record.json');
	if (!text) throw new Error('Expected portable generation');
	const cwd = await freshCwd();
	const directory = join(cwd, '.lightsout/plans', fixture.name);
	await mkdir(directory, { recursive: true });
	await installPlanningGeneration({ directory, name: fixture.name, text, expectedDigest: sha256({ content: text }) });

	const original = await readHandoffSources(fixture);
	const restored = await readHandoffSources({ cwd, plan: fixture.plan, handoff: fixture.handoff });

	expect(restored).toStrictEqual(original);
});

test('rejects an overview from another plan while reading a frozen phase', async () => {
	const fixture = await planningHandoffFixture({ phased: true });
	await expect(
		readHandoffSources({
			...fixture,
			plan: join('.lightsout/plans', fixture.name, fixture.handoff.phases[0].path),
			overview: '.lightsout/plans/different/overview.md',
		}),
	).rejects.toThrow('overview differs');
});
