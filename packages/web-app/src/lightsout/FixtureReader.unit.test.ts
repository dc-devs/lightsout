import { describe, expect, test } from '@jest/globals';
import { PlanDocumentKind, RunNotFoundError, StandardsPackNotFoundError, StandardsPackRuleNotFoundError } from '@lightsout/engine';
import { DemoRunSlug } from '#src/lightsout/common/constants/DemoRunSlug.ts';
import { getDemoRunViews } from '#src/lightsout/common/utils/getDemoRunViews.ts';
import { FixtureReader } from '#src/lightsout/FixtureReader.ts';

const setupReader = () => ({ reader: new FixtureReader(), views: getDemoRunViews() });

describe('FixtureReader', () => {
	test('lists the three frozen runs, so a build with no repo still has a runs page', async () => {
		const { reader } = setupReader();

		const runs = await reader.listRuns();

		expect(runs).toHaveLength(3);
	});

	test('answers for a run by its full id', async () => {
		const { reader, views } = setupReader();
		const { runId } = views[DemoRunSlug.Implement].listing;

		const view = await reader.getRun({ runId });

		expect(view.listing.runId).toBe(runId);
	});

	test('answers for the same run by the shortened id a report printed, which is what the frame’s address bar shows', async () => {
		const { reader, views } = setupReader();
		const { shortId, runId } = views[DemoRunSlug.Refactor].listing;

		const view = await reader.getRun({ runId: shortId });

		expect(view.listing.runId).toBe(runId);
	});

	test('rejects an unknown id with the engine’s own error, which is what the server function turns into a 404', async () => {
		const { reader } = setupReader();

		await expect(reader.getRun({ runId: 'no-such-run' })).rejects.toBeInstanceOf(RunNotFoundError);
	});

	test('answers the standards view with its empty form and says why, rather than failing a deep link', async () => {
		const { reader } = setupReader();

		const standards = await reader.getStandards();

		expect({ findings: standards.findings, rules: standards.rules, notes: standards.notes }).toStrictEqual({
			findings: [],
			rules: [],
			notes: ['No repository was found — this is the public build, which serves no standards check.'],
		});
	});

	test('reports the check as never having run rather than as having run somewhere: no timestamp, no history, and the repo root said plainly', async () => {
		const { reader } = setupReader();

		const standards = await reader.getStandards();

		expect({ hasTimestamp: 'at' in standards, path: standards.path, trend: standards.trend }).toStrictEqual({ hasTimestamp: false, path: '.', trend: [] });
	});

	test('zeroes every standards total rather than leaving a page to count for itself', async () => {
		const { reader } = setupReader();

		const standards = await reader.getStandards();

		expect(standards.totals).toStrictEqual({ rules: 0, checked: 0, judgment: 0, blocking: 0, advisory: 0, orphans: 0 });
	});

	test('records a plan as absent rather than throwing, so a drawer degrades instead of crashing', async () => {
		const { reader } = setupReader();

		const plan = await reader.getPlan({ path: '.lightsout/plans/add-search.md' });

		expect(plan).toStrictEqual({ path: '.lightsout/plans/add-search.md', kind: PlanDocumentKind.Missing });
	});

	test('lists the bundled authored default pack, read from no disk at all', async () => {
		const { reader } = setupReader();

		const packs = await reader.listPacks();

		expect(packs.map((pack) => ({ name: pack.name, isDefault: pack.isDefault, built: pack.built }))).toStrictEqual([
			{ name: 'lightsout-defaults', isDefault: true, built: false },
		]);
	});

	test('returns that pack as its page shows it: every document a group and every rule a row', async () => {
		const { reader } = setupReader();

		const view = await reader.getPack({ name: 'lightsout-defaults' });

		expect({ documents: view.documents.length, rules: view.rules.length }).toStrictEqual({
			documents: view.totals.documents,
			rules: view.totals.rules,
		});
	});

	test('rejects a pack name this build does not carry', async () => {
		const { reader } = setupReader();

		await expect(reader.getPack({ name: 'acme' })).rejects.toBeInstanceOf(StandardsPackNotFoundError);
	});

	test('returns one rule whole — its prose and the text of the files that prove it', async () => {
		const { reader } = setupReader();

		const rule = await reader.getPackRule({ name: 'lightsout-defaults', rule: 'type-assertion' });

		expect({ id: rule.id, hasProse: rule.prose.length > 0, hasFixtures: rule.fixtures.length > 0 }).toStrictEqual({
			id: 'type-assertion',
			hasProse: true,
			hasFixtures: true,
		});
	});

	test('rejects a rule of a pack name this build does not carry', async () => {
		const { reader } = setupReader();

		await expect(reader.getPackRule({ name: 'acme', rule: 'type-assertion' })).rejects.toBeInstanceOf(StandardsPackNotFoundError);
	});

	test('rejects a rule id the bundled pack does not hold', async () => {
		const { reader } = setupReader();

		await expect(reader.getPackRule({ name: 'lightsout-defaults', rule: 'no-such-rule' })).rejects.toBeInstanceOf(StandardsPackRuleNotFoundError);
	});
});
