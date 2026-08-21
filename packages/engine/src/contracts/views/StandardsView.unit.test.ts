import { describe, expect, test } from '@jest/globals';
import { StandardsView } from '#src/contracts/index.ts';

const buildRuleView = (extra: Record<string, unknown> = {}) => ({
	rule: 'size-file',
	doc: '@lightsout/standards: code/size-file',
	documentPath: 'code/size-file',
	set: 'code',
	summary: 'A source file stays under its line cap.',
	prose: '# Size, File\n\nA file past the cap is several modules sharing one name.',
	checked: true,
	severity: 'blocking',
	fromConfig: false,
	settings: { maxLines: 400 },
	findingCount: 1,
	history: { attempted: 1, resolved: 1, declined: 0, untracked: 0, adviceApplied: 0, adviceDeclined: 0, adviceAlreadyMet: 0, reasons: [] },
	...extra,
});

const buildFinding = (extra: Record<string, unknown> = {}) => ({
	rule: 'size-file',
	severity: 'blocking',
	siteKey: 'size-file:src/views/getStandardsView.ts',
	files: [{ path: 'src/views/getStandardsView.ts', startLine: 1, endLine: 420 }],
	detail: 'a 420-line file, 20 over the cap',
	...extra,
});

const buildTrendPoint = (extra: Record<string, unknown> = {}) => ({
	at: '2026-08-18T09:00:00.000Z',
	path: '.',
	total: 2,
	blocking: 2,
	advisory: 0,
	byRule: [{ rule: 'size-file', count: 2 }],
	...extra,
});

const setupView = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const view: Record<string, unknown> = {
		at: '2026-08-19T10:15:30.123Z',
		path: '.',
		notes: ['skipped one unreadable package'],
		findings: [buildFinding()],
		rules: [buildRuleView()],
		trend: [buildTrendPoint()],
		totals: { rules: 37, checked: 34, judgment: 3, blocking: 1, advisory: 0, orphans: 0 },
		...extra,
	};

	if (omit) {
		delete view[omit];
	}

	return { view };
};

describe('StandardsView', () => {
	test('a repo with a snapshot parses with its findings, rules, trend and totals intact', () => {
		const { view } = setupView();

		const parsed = StandardsView.parse(view);

		expect(parsed).toStrictEqual({
			at: '2026-08-19T10:15:30.123Z',
			path: '.',
			notes: ['skipped one unreadable package'],
			findings: [buildFinding()],
			rules: [buildRuleView()],
			trend: [buildTrendPoint()],
			totals: { rules: 37, checked: 34, judgment: 3, blocking: 1, advisory: 0, orphans: 0 },
		});
	});

	test('a repo that has never run a check parses with no timestamp and empty lists', () => {
		const { view } = setupView({
			omit: 'at',
			extra: {
				notes: [],
				findings: [],
				rules: [],
				trend: [],
				totals: { rules: 0, checked: 0, judgment: 0, blocking: 0, advisory: 0, orphans: 0 },
			},
		});

		const parsed = StandardsView.parse(view);

		// a fresh clone has to render — the absent timestamp is the normal state that
		// says "no check has run", not a malformed payload
		expect(parsed).toStrictEqual({
			path: '.',
			notes: [],
			findings: [],
			rules: [],
			trend: [],
			totals: { rules: 0, checked: 0, judgment: 0, blocking: 0, advisory: 0, orphans: 0 },
		});
	});

	test('every loaded rule keeps its row even with nothing open', () => {
		const { view } = setupView({
			extra: {
				findings: [],
				rules: [
					buildRuleView({ findingCount: 0 }),
					buildRuleView({ rule: 'clone', doc: '@lightsout/standards: code/clone', documentPath: 'code/clone', findingCount: 0 }),
				],
				totals: { rules: 2, checked: 2, judgment: 0, blocking: 0, advisory: 0, orphans: 0 },
			},
		});

		const parsed = StandardsView.parse(view);

		// the rules list is every rule the repo enforces, not only the broken ones
		expect(parsed.rules.map((rule) => rule.rule)).toStrictEqual(['size-file', 'clone']);
	});

	test('a finding whose rule no package loads is counted as an orphan', () => {
		const { view } = setupView({
			extra: {
				findings: [buildFinding({ rule: 'retired-rule', siteKey: 'retired-rule:src/index.ts' })],
				rules: [buildRuleView({ findingCount: 0 })],
				totals: { rules: 1, checked: 1, judgment: 0, blocking: 1, advisory: 0, orphans: 1 },
			},
		});

		const parsed = StandardsView.parse(view);

		// a package removed or a rule switched off since the scan leaves findings
		// belonging to no row — the header reports them rather than dropping them
		expect(parsed).toEqual(expect.objectContaining({ totals: expect.objectContaining({ orphans: 1 }) }));
	});

	test('the trend carries every dated point it was given, in the order it was given', () => {
		const { view } = setupView({
			extra: {
				trend: [
					buildTrendPoint({ at: '2026-08-17T09:00:00.000Z', total: 9, blocking: 9 }),
					buildTrendPoint({ at: '2026-08-18T09:00:00.000Z', total: 4, blocking: 4 }),
					buildTrendPoint({ at: '2026-08-19T09:00:00.000Z', total: 1, blocking: 1 }),
				],
			},
		});

		const parsed = StandardsView.parse(view);

		// oldest first is the contract, so a chart plots the array as it stands —
		// the boundary must not reorder it
		expect(parsed.trend.map((point) => point.at)).toStrictEqual(['2026-08-17T09:00:00.000Z', '2026-08-18T09:00:00.000Z', '2026-08-19T09:00:00.000Z']);
	});

	test('a check scoped to a subpath keeps the subpath verbatim', () => {
		const { view } = setupView({ extra: { path: 'packages/engine' } });

		const parsed = StandardsView.parse(view);

		expect(parsed.path).toBe('packages/engine');
	});

	test('the notes the check recorded ride the view verbatim', () => {
		const { view } = setupView({ extra: { notes: ['agent review skipped: no findings', 'one package failed to load'] } });

		const parsed = StandardsView.parse(view);

		// the notes are the only place a check explains what it could not do
		expect(parsed.notes).toStrictEqual(['agent review skipped: no findings', 'one package failed to load']);
	});

	test('the path, the four lists and the totals are each required', () => {
		for (const field of ['path', 'notes', 'findings', 'rules', 'trend', 'totals']) {
			const { view } = setupView({ omit: field });

			const result = StandardsView.safeParse(view);

			// ${field} is iterated or read unconditionally — only the timestamp is
			// allowed to be absent, because only "never checked" is a real state
			expect(result.success).toBe(false);
		}
	});

	test('every total is required', () => {
		for (const field of ['rules', 'checked', 'judgment', 'blocking', 'advisory', 'orphans']) {
			const { view } = setupView();
			const totals = { ...(view.totals as Record<string, unknown>) };
			delete totals[field];
			view.totals = totals;

			const result = StandardsView.safeParse(view);

			// the totals exist so no consumer ever counts for itself; a missing one
			// would push that count back into the reader it was moved out of
			expect(result.success).toBe(false);
		}
	});

	test('rejects a total given as a numeric string rather than coercing it', () => {
		const { view } = setupView({ extra: { totals: { rules: '37', checked: 34, judgment: 3, blocking: 1, advisory: 0, orphans: 0 } } });

		const result = StandardsView.safeParse(view);

		expect(result.success).toBe(false);
	});

	test('rejects a timestamp that is present but not a string', () => {
		const { view } = setupView({ extra: { at: 1_755_600_930_123 } });

		const result = StandardsView.safeParse(view);

		// the field is optional, not free-form — it is compared and rendered as text
		expect(result.success).toBe(false);
	});

	test('rejects a finding at severity `off` — a switched-off rule emits nothing', () => {
		const { view } = setupView({ extra: { findings: [buildFinding({ severity: 'off' })] } });

		const result = StandardsView.safeParse(view);

		// a rule row may sit at `off`, but a persisted finding carrying it is a
		// contradiction the finding contract refuses, and the view inherits that
		expect(result.success).toBe(false);
	});

	test('rejects a finding missing the fields the finding contract requires', () => {
		const { view } = setupView({ extra: { findings: [{ rule: 'size-file', severity: 'blocking' }] } });

		const result = StandardsView.safeParse(view);

		// the findings are validated through the same shape the snapshot writes, so
		// the two can never drift
		expect(result.success).toBe(false);
	});

	test('rejects a rule row whose standards set is not one the packages declare', () => {
		const { view } = setupView({ extra: { rules: [buildRuleView({ set: 'docs' })] } });

		const result = StandardsView.safeParse(view);

		expect(result.success).toBe(false);
	});

	test('rejects a rule row missing its history block', () => {
		const { view } = setupView({ extra: { rules: [buildRuleView({ history: undefined })] } });

		const result = StandardsView.safeParse(view);

		expect(result.success).toBe(false);
	});

	test('rejects a trend point missing a count', () => {
		const { view } = setupView({ extra: { trend: [buildTrendPoint({ blocking: undefined })] } });

		const result = StandardsView.safeParse(view);

		// the trend is validated point by point — one malformed point would plot as a
		// gap the chart cannot label
		expect(result.success).toBe(false);
	});

	test('rejects the lists given as a single object rather than an array', () => {
		for (const extra of [{ findings: buildFinding() }, { rules: buildRuleView() }, { trend: buildTrendPoint() }, { notes: 'one note' }]) {
			const { view } = setupView({ extra });

			const result = StandardsView.safeParse(view);

			expect(result.success).toBe(false);
		}
	});

	test('keys the contract does not declare are stripped from the view and from its totals', () => {
		const { view } = setupView({
			extra: {
				baseline: { 'size-file:src/views/getStandardsView.ts': true },
				totals: { rules: 37, checked: 34, judgment: 3, blocking: 1, advisory: 0, orphans: 0, off: 2 },
			},
		});

		const parsed = StandardsView.parse(view);

		// the view is the whole payload a reader renders — anything else it happened
		// to be handed stays out, so the shape a consumer types against is the shape
		// it gets
		expect(parsed).toEqual(expect.objectContaining({ totals: { rules: 37, checked: 34, judgment: 3, blocking: 1, advisory: 0, orphans: 0 } }));
		expect(parsed).not.toHaveProperty('baseline');
	});

	test('an advisory finding reaches the view beside a blocking one, and both severity totals with it', () => {
		const { view } = setupView({
			extra: {
				findings: [buildFinding(), buildFinding({ rule: 'clone', severity: 'advisory', siteKey: 'clone:src/views/listRuns.ts' })],
				rules: [buildRuleView(), buildRuleView({ rule: 'clone', doc: '@lightsout/standards: code/clone', documentPath: 'code/clone', severity: 'advisory' })],
				totals: { rules: 2, checked: 2, judgment: 0, blocking: 1, advisory: 1, orphans: 0 },
			},
		});

		const parsed = StandardsView.parse(view);

		// both reporting severities survive the boundary and are counted apart — a
		// header carrying only the blocking count would report a repo with open
		// advisories as clean
		expect(parsed).toEqual(
			expect.objectContaining({
				findings: [expect.objectContaining({ rule: 'size-file', severity: 'blocking' }), expect.objectContaining({ rule: 'clone', severity: 'advisory' })],
				totals: expect.objectContaining({ blocking: 1, advisory: 1 }),
			}),
		);
	});
});
