import { describe, expect, test } from '@jest/globals';
import { commandCatalog } from '#src/commands/index.ts';
import { CommandCatalogEntry } from '#src/contracts/index.ts';

const setupCatalog = () => {
	const ids = commandCatalog.map((entry) => entry.id);
	const byId = new Map(commandCatalog.map((entry) => [entry.id, entry]));

	return { ids, byId };
};

describe('commandCatalog', () => {
	test('every entry satisfies its own contract', () => {
		const { ids } = setupCatalog();
		const rejected = commandCatalog.filter((entry) => !CommandCatalogEntry.safeParse(entry).success).map((entry) => entry.id);

		expect(rejected).toStrictEqual([]);
		expect(ids).toHaveLength(22);
	});

	test('ids are unique — two entries answering to one word would make the route ambiguous', () => {
		const { ids } = setupCatalog();

		expect([...new Set(ids)]).toStrictEqual(ids);
	});

	test('covers every command the dispatcher offers, plus the two skills that have no command', () => {
		const { ids } = setupCatalog();

		expect([...ids].sort()).toStrictEqual(
			[
				'auto-plan',
				'brainstorm',
				'doctor',
				'friction',
				'implement',
				'implement-direct',
				'improve',
				'plan',
				'queue',
				'refactor',
				'report',
				'resume',
				'self-check',
				'ship',
				'standards-check',
				'standards-health',
				'standards-validate',
				'status',
				'test-coverage-to-threshold',
				'work-order',
				'ticket-state',
				'voice',
			].sort(),
		);
	});

	test('related names only ids the catalog carries, and never the entry itself', () => {
		const { byId } = setupCatalog();
		const stray = commandCatalog.flatMap((entry) => entry.related.filter((id) => !byId.has(id) || id === entry.id));

		expect(stray).toStrictEqual([]);
	});

	test('related is symmetric — a page that lists a neighbour is listed back by it', () => {
		const { byId } = setupCatalog();
		const pairs = commandCatalog.flatMap((entry) => entry.related.map((id) => ({ from: entry.id, to: id })));
		const oneWay = pairs.filter((pair) => byId.get(pair.to)?.related.includes(pair.from) !== true);

		expect(oneWay).toStrictEqual([]);
	});

	test('every invocation id is unique across the catalog, since the usage order addresses them by id alone', () => {
		const invocationIds = commandCatalog.flatMap((entry) => entry.invocations.map((invocation) => invocation.id));

		expect([...new Set(invocationIds)]).toStrictEqual(invocationIds);
	});

	test('every flag shape names an invocation of its own entry — a shape nothing matches would never reach a usage line', () => {
		const orphans = commandCatalog.flatMap((entry) =>
			entry.flags.filter((flag) => flag.shape !== undefined && !entry.invocations.some((invocation) => invocation.id === flag.shape)),
		);

		expect(orphans).toStrictEqual([]);
	});

	test('a command with a CLI form has at least one invocation, and the skill-only commands have none', () => {
		const { byId } = setupCatalog();
		const shapeless = commandCatalog.filter((entry) => entry.cli !== undefined && entry.invocations.length === 0);

		expect(shapeless).toStrictEqual([]);
		expect(byId.get('auto-plan')?.invocations).toStrictEqual([]);
	});

	test('routes the one brainstorm subcommand as its own invocation', () => {
		const { byId } = setupCatalog();
		const brainstormShapes = byId.get('brainstorm')?.invocations.map((invocation) => [invocation.id, invocation.positional]);

		expect(brainstormShapes).toStrictEqual([['brainstorm-publish', 'publish']]);
	});

	test('routes every plan subcommand as its own invocation, in the order a plan is worked through', () => {
		const { byId } = setupCatalog();
		const planShapes = byId.get('plan')?.invocations.map((invocation) => [invocation.id, invocation.positional]);

		expect(planShapes).toStrictEqual([
			['plan-workspace', 'workspace'],
			['plan-verify-facts', 'verify-facts'],
			['plan-draft', 'draft'],
			['plan-sync-decisions', 'sync-decisions'],
			['plan-lint', 'lint'],
			['plan-dedup', 'dedup'],
			['plan-grade', 'grade'],
			['plan-publish', 'publish'],
		]);
	});

	test('carries plan sync-decisions as its own invocation, between draft and lint', () => {
		const { byId } = setupCatalog();
		const invocations = byId.get('plan')?.invocations ?? [];

		const placed = invocations.findIndex((invocation) => invocation.positional === 'sync-decisions');

		expect(invocations[placed]).toStrictEqual({ id: 'plan-sync-decisions', positional: 'sync-decisions' });
		expect([invocations[placed - 1]?.positional, invocations[placed + 1]?.positional]).toStrictEqual(['draft', 'lint']);
	});

	test('plan lists its workspace shape ahead of verify-facts, because it runs before anything else', () => {
		const { byId } = setupCatalog();

		const leading = byId.get('plan')?.invocations.slice(0, 2);

		expect(leading).toStrictEqual([
			{ id: 'plan-workspace', positional: 'workspace' },
			{ id: 'plan-verify-facts', positional: 'verify-facts' },
		]);
	});

	test('notes the extra meaning only on the plan subcommand whose flag changes its result', () => {
		const { byId } = setupCatalog();
		const noted = byId
			.get('plan')
			?.invocations.filter((invocation) => invocation.note !== undefined)
			.map((invocation) => invocation.id);

		expect(noted).toStrictEqual(['plan-grade']);
	});

	test('leaves exactly the skill-only command without a CLI word, so nothing types `lightsout auto-plan` at a route that is not there', () => {
		const skillOnly = commandCatalog.filter((entry) => entry.cli === undefined).map((entry) => entry.id);

		expect(skillOnly).toStrictEqual(['auto-plan']);
	});

	test('only the three commands with an infographic carry steps, and each carries a graphic to draw them in', () => {
		const drawn = commandCatalog.filter((entry) => entry.steps.length > 0);

		expect(drawn.map((entry) => [entry.id, entry.steps.length])).toStrictEqual([
			['plan', 8],
			['implement', 10],
			['refactor', 12],
		]);
		expect(drawn.every((entry) => entry.graphic !== undefined)).toBe(true);
	});

	test('runs in group order, so the commands page reads its sections straight off the array', () => {
		const sectioned = commandCatalog.map((entry) => [entry.group, entry.id]);

		expect(sectioned).toStrictEqual([
			['build', 'brainstorm'],
			['build', 'plan'],
			['build', 'auto-plan'],
			['build', 'implement'],
			['build', 'implement-direct'],
			['build', 'resume'],
			['build', 'ship'],
			['build', 'queue'],
			['build', 'work-order'],
			['build', 'ticket-state'],
			['build', 'self-check'],
			['burn-down', 'refactor'],
			['burn-down', 'test-coverage-to-threshold'],
			['standards', 'standards-check'],
			['standards', 'standards-validate'],
			['standards', 'standards-health'],
			['housekeeping', 'status'],
			['housekeeping', 'report'],
			['housekeeping', 'doctor'],
			['housekeeping', 'friction'],
			['housekeeping', 'improve'],
			['housekeeping', 'voice'],
		]);
	});

	test('related names every other member of the entry’s group — a pair missing from both sides would still look symmetric', () => {
		const missing = commandCatalog.flatMap((entry) =>
			commandCatalog
				.filter((other) => other.group === entry.group && other.id !== entry.id && !entry.related.includes(other.id))
				.map((other) => `${entry.id} → ${other.id}`),
		);

		expect(missing).toStrictEqual([]);
	});

	test('names the kind of record each command leaves behind, which is the shape of its history section', () => {
		const kinds = commandCatalog.map((entry) => [entry.id, entry.records]);

		expect(kinds).toStrictEqual([
			['brainstorm', 'plans'],
			['plan', 'plans'],
			['auto-plan', 'plans'],
			['implement', 'runs'],
			['implement-direct', 'runs'],
			['resume', 'runs'],
			['ship', 'nothing'],
			['queue', 'runs'],
			['work-order', 'plans'],
			['ticket-state', 'nothing'],
			['self-check', 'nothing'],
			['refactor', 'runs'],
			['test-coverage-to-threshold', 'runs'],
			['standards-check', 'snapshots'],
			['standards-validate', 'nothing'],
			['standards-health', 'nothing'],
			['status', 'nothing'],
			['report', 'nothing'],
			['doctor', 'nothing'],
			['friction', 'nothing'],
			['improve', 'nothing'],
			['voice', 'nothing'],
		]);
	});

	test('carries a slash form for exactly the commands the plugin ships a skill for', () => {
		const slashed = commandCatalog.filter((entry) => entry.slash !== undefined).map((entry) => [entry.id, entry.slash]);

		expect(slashed).toStrictEqual([
			['brainstorm', '/brainstorm'],
			['plan', '/plan'],
			['auto-plan', '/auto-plan'],
			['implement', '/implement'],
			['refactor', '/refactor'],
			['test-coverage-to-threshold', '/test-coverage-to-threshold'],
			['voice', '/lightsout:voice'],
		]);
	});

	test('every entry says what it does and when to reach for it — both are the command page’s body copy', () => {
		const silent = commandCatalog.filter((entry) => entry.summary.trim() === '' || entry.whenToUse.trim() === '').map((entry) => entry.id);

		expect(silent).toStrictEqual([]);
	});

	test('every flag states what it means, which is the middle column of the manual’s flag table', () => {
		const mute = commandCatalog.flatMap((entry) => entry.flags.filter((flag) => flag.meaning.trim() === '').map((flag) => `${entry.id} --${flag.name}`));

		expect(mute).toStrictEqual([]);
	});

	test('gives ticket-state one required reference and three optional flags, since a tracker write with no ticket has no subject', () => {
		const { byId } = setupCatalog();
		const flags = byId.get('ticket-state')?.flags.map((flag) => [flag.name, flag.value, flag.required]);

		expect(flags).toStrictEqual([
			['ref', '<ticket>', true],
			['planning-status', '<status>', false],
			['tracker-status', 'ready|in-progress', false],
			['cwd', '<path>', false],
		]);
	});

	test('names all five planning statuses in --planning-status, which is the only place the caller learns what the flag accepts', () => {
		const { byId } = setupCatalog();
		const planningStatus = byId.get('ticket-state')?.flags.find((flag) => flag.name === 'planning-status');

		expect(planningStatus?.meaning).toEqual(
			expect.stringMatching(/planning-needs-brainstorm.*planning-needs-plan.*planning-ready-auto-plan.*planning-complete.*planning-not-needed/),
		);
	});

	test('names the two roles --tracker-status accepts and says done is not one of them, because done follows a confirmed merge', () => {
		const { byId } = setupCatalog();
		const trackerStatus = byId.get('ticket-state')?.flags.find((flag) => flag.name === 'tracker-status');

		expect(trackerStatus?.meaning).toEqual(expect.stringMatching(/\bready\b.*\bin-progress\b/));
		expect(trackerStatus?.meaning).toEqual(expect.stringMatching(/[Dd]one is not among them/));
	});

	test('says a resumed run returns to the workspace it recorded, and that a direct run is continued here rather than re-run from its ticket', () => {
		const { byId } = setupCatalog();
		const resume = byId.get('resume');

		expect(resume?.summary).toEqual(expect.stringMatching(/workspace that run recorded/));
		expect(resume?.whenToUse).toEqual(expect.stringMatching(/returns to the checkout that run recorded/));
		expect(resume?.whenToUse).toEqual(expect.stringMatching(/[Dd]irect run.*frozen beside the run/));
	});

	test('a flag that takes a value names its placeholder, so the usage line never prints a bare --flag that needs one', () => {
		const { byId } = setupCatalog();
		const valued = byId.get('test-coverage-to-threshold')?.flags.map((flag) => [flag.name, flag.value]);

		expect(valued).toStrictEqual([
			['run', '<id>'],
			['cwd', '<path>'],
			['max-batches', '<n>'],
			['allow-dirty', undefined],
		]);
	});

	test('commandCatalog: report declares the plan, json and cwd flags and no others', () => {
		const { byId } = setupCatalog();

		const report = byId.get('report');

		expect(report).toEqual(
			expect.objectContaining({
				id: 'report',
				cli: 'lightsout report',
				group: 'housekeeping',
				invocations: [{ id: 'report' }],
				records: 'nothing',
			}),
		);
		expect(report?.flags.map((flag) => [flag.name, flag.value, flag.required])).toStrictEqual([
			['plan', '<name>', true],
			['json', undefined, false],
			['cwd', '<path>', false],
		]);
	});

	test('commandCatalog: report is related to every other housekeeping command, both ways', () => {
		const { byId } = setupCatalog();
		const neighbours = ['status', 'doctor', 'friction', 'improve', 'voice'];

		const named = [...(byId.get('report')?.related ?? [])].sort();
		const silentBack = neighbours.filter((id) => byId.get(id)?.related.includes('report') !== true);

		expect(named).toStrictEqual([...neighbours].sort());
		expect(silentBack).toStrictEqual([]);
	});

	test('commandCatalog: no catalog entry names the pre-layout plans folder', () => {
		const { byId } = setupCatalog();
		const savedLines = commandCatalog.flatMap((entry) => entry.steps.flatMap((step) => step.saved.map((path) => `${entry.id} saved ${path}`)));
		const meaningLines = commandCatalog.flatMap((entry) => entry.flags.map((flag) => `${entry.id} --${flag.name} ${flag.meaning}`));
		const planStatePaths = (byId.get('plan')?.steps.flatMap((step) => step.saved) ?? []).filter((path) => path.startsWith('.lightsout/'));
		const nameMeanings = ['plan', 'brainstorm', 'work-order'].map((id) => byId.get(id)?.flags.find((flag) => flag.name === 'name')?.meaning);

		const stale = [...savedLines, ...meaningLines].filter((line) => line.includes('.lightsout/plans'));
		const unmoved = planStatePaths.filter((path) => !path.startsWith('.lightsout/work-orders/'));

		expect(stale).toStrictEqual([]);
		expect(planStatePaths).not.toHaveLength(0);
		expect(unmoved).toStrictEqual([]);
		expect(nameMeanings).toEqual([
			expect.stringContaining('.lightsout/work-orders/'),
			expect.stringContaining('.lightsout/work-orders/'),
			expect.stringContaining('.lightsout/work-orders/'),
		]);
	});

	test('commandCatalog: the work-order entry carries the renamed id, cli and eight invocation ids, and no entry answers to ticket', () => {
		const { ids, byId } = setupCatalog();

		const workOrder = byId.get('work-order');

		expect(workOrder).toEqual(expect.objectContaining({ id: 'work-order', cli: 'lightsout work-order', group: 'build', records: 'plans' }));
		expect(workOrder?.invocations.map((invocation) => [invocation.id, invocation.positional])).toStrictEqual([
			['work-order-new', 'new'],
			['work-order-add-plan', 'add-plan'],
			['work-order-mode', 'mode'],
			['work-order-request-ship', 'request-ship'],
			['work-order-exclude-plan', 'exclude-plan'],
			['work-order-retitle-plan', 'retitle-plan'],
			['work-order-show', 'show'],
			['work-order-sync', 'sync'],
		]);
		expect(ids[ids.indexOf('work-order') + 1]).toBe('ticket-state');
		expect(ids).not.toContain('ticket');
	});

	test('commandCatalog: the work-order related graph is symmetric and no entry still names ticket', () => {
		const { byId } = setupCatalog();
		const naming = commandCatalog.filter((entry) => entry.related.includes('work-order'));

		const silentBack = naming.filter((entry) => byId.get('work-order')?.related.includes(entry.id) !== true).map((entry) => entry.id);
		const stale = commandCatalog.filter((entry) => entry.related.includes('ticket')).map((entry) => entry.id);
		const droppedTracker = naming.filter((entry) => entry.id !== 'ticket-state' && !entry.related.includes('ticket-state')).map((entry) => entry.id);

		expect(silentBack).toStrictEqual([]);
		expect(stale).toStrictEqual([]);
		expect(droppedTracker).toStrictEqual([]);
		expect(naming.map((entry) => entry.id).sort()).toStrictEqual(
			['auto-plan', 'brainstorm', 'plan', 'implement', 'implement-direct', 'resume', 'ship', 'queue', 'ticket-state', 'self-check'].sort(),
		);
	});
});
