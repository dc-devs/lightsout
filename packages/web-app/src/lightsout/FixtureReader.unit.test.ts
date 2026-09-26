import { describe, expect, test } from '@jest/globals';
import { ConfigNotFoundError, PlanDocumentKind, PlanWorkspaceNotFoundError, RunNotFoundError } from '@lightsout/engine';
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

	test('answers with the engine’s whole command catalog — all twenty-two commands in group order, since a build with no repo still documents them', async () => {
		const { reader } = setupReader();

		const commands = await reader.listCommands();

		expect(commands.map((entry) => entry.id)).toStrictEqual([
			'brainstorm',
			'plan',
			'auto-plan',
			'implement',
			'implement-direct',
			'resume',
			'ship',
			'queue',
			'work-order',
			'ticket-state',
			'self-check',
			'refactor',
			'test-coverage-to-threshold',
			'standards-check',
			'standards-validate',
			'standards-health',
			'status',
			'report',
			'doctor',
			'friction',
			'improve',
			'voice',
		]);
	});

	test('hands each command over whole, so a command page renders from this one answer and asks for nothing more', async () => {
		const { reader } = setupReader();

		const commands = await reader.listCommands();
		const implement = commands.find((entry) => entry.id === 'implement');

		expect(implement).toEqual(
			expect.objectContaining({
				slash: '/implement',
				cli: 'lightsout implement',
				group: 'build',
				records: 'runs',
				flags: expect.arrayContaining([expect.objectContaining({ name: 'plan', value: '<path>', required: true })]),
			}),
		);
	});

	test('carries the drawn steps a command has, so the page draws the run rather than summarising it', async () => {
		const { reader } = setupReader();

		const commands = await reader.listCommands();
		const implement = commands.find((entry) => entry.id === 'implement');

		expect(implement?.steps).toHaveLength(10);
	});

	test('says what each command leaves behind, which is what its card and its history section are shaped by', async () => {
		const { reader } = setupReader();

		const commands = await reader.listCommands();
		const records = Object.fromEntries(commands.map((entry) => [entry.id, entry.records]));

		expect(records).toStrictEqual({
			brainstorm: 'plans',
			plan: 'plans',
			'auto-plan': 'plans',
			implement: 'runs',
			'implement-direct': 'runs',
			resume: 'runs',
			ship: 'nothing',
			queue: 'runs',
			'work-order': 'plans',
			'ticket-state': 'nothing',
			'self-check': 'nothing',
			refactor: 'runs',
			'test-coverage-to-threshold': 'runs',
			'standards-check': 'snapshots',
			'standards-validate': 'nothing',
			'standards-health': 'nothing',
			status: 'nothing',
			report: 'nothing',
			doctor: 'nothing',
			friction: 'nothing',
			improve: 'nothing',
			voice: 'nothing',
		});
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

	test('answers the friction log with an empty list rather than an absence, since a build with no repo has nothing that ever reported friction', async () => {
		const { reader } = setupReader();

		const friction = await reader.getFriction();

		expect(friction).toStrictEqual([]);
	});

	test('refuses the config with the engine’s own not-found error, which the server function turns into a 404 — a page about a file that is not there', async () => {
		const { reader } = setupReader();

		await expect(reader.getConfig()).rejects.toBeInstanceOf(ConfigNotFoundError);
	});

	test('names the file it looked for in that refusal, so the 404 says which file is missing', async () => {
		const { reader } = setupReader();

		await expect(reader.getConfig()).rejects.toThrow(/lightsout\.config\.json/);
	});

	test('lists no plan workspaces, because a public site holds no repo for anyone to have planned in', async () => {
		const { reader } = setupReader();

		const plans = await reader.listPlanWorkspaces();

		expect(plans).toStrictEqual([]);
	});

	test('rejects any plan name, since a page about one workspace is a 404 on a build that holds none', async () => {
		const { reader } = setupReader();

		await expect(reader.getPlanWorkspace({ name: 'add-search' })).rejects.toBeInstanceOf(PlanWorkspaceNotFoundError);
	});

	test('names the workspace the URL asked for in that refusal, so the 404 says which plan was looked for', async () => {
		const { reader } = setupReader();

		await expect(reader.getPlanWorkspace({ name: 'add-search' })).rejects.toThrow(/add-search/);
	});
});
