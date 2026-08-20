import { describe, expect, test } from '@jest/globals';
import { StandardsRuleView } from '#src/contracts/index.ts';

const setupRuleView = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const ruleView: Record<string, unknown> = {
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
		findingCount: 3,
		history: {
			attempted: 5,
			resolved: 4,
			declined: 1,
			untracked: 0,
			adviceApplied: 2,
			adviceDeclined: 1,
			reasons: ['the span is a schema, not duplication'],
		},
		...extra,
	};

	if (omit) {
		delete ruleView[omit];
	}

	return { ruleView };
};

describe('StandardsRuleView', () => {
	test('a rule with findings and refactor history parses with both halves intact', () => {
		const { ruleView } = setupRuleView();

		const parsed = StandardsRuleView.parse(ruleView);

		expect(parsed).toStrictEqual({
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
			findingCount: 3,
			history: {
				attempted: 5,
				resolved: 4,
				declined: 1,
				untracked: 0,
				adviceApplied: 2,
				adviceDeclined: 1,
				reasons: ['the span is a schema, not duplication'],
			},
		});
	});

	test('a rule with nothing open and no refactor history parses at zero', () => {
		const { ruleView } = setupRuleView({
			extra: {
				findingCount: 0,
				history: { attempted: 0, resolved: 0, declined: 0, untracked: 0, adviceApplied: 0, adviceDeclined: 0, reasons: [] },
			},
		});

		const parsed = StandardsRuleView.parse(ruleView);

		// every loaded rule gets a row, findings or not — the view answers "what does
		// this repo enforce?", so a quiet rule must parse rather than be dropped
		expect(parsed).toEqual(
			expect.objectContaining({
				findingCount: 0,
				history: { attempted: 0, resolved: 0, declined: 0, untracked: 0, adviceApplied: 0, adviceDeclined: 0, reasons: [] },
			}),
		);
	});

	test('both standards sets parse — the split that decides which role reads the document', () => {
		for (const set of ['code', 'tests']) {
			const { ruleView } = setupRuleView({ extra: { set } });

			const parsed = StandardsRuleView.parse(ruleView);

			// ${set} names the document tree the rule lives in: one is handed to
			// code-writing roles, the other to the test writer
			expect(parsed.set).toBe(set);
		}
	});

	test('rejects a standards set outside the two the packages declare', () => {
		for (const set of ['docs', 'Code', '']) {
			const { ruleView } = setupRuleView({ extra: { set } });

			const result = StandardsRuleView.safeParse(ruleView);

			// the set is validated against the const object rather than left a free
			// string — an unknown tree would file the rule under a heading no reader
			// renders
			expect(result.success).toBe(false);
		}
	});

	test('all three severities parse, `off` included — the state a rule listing may report', () => {
		for (const severity of ['blocking', 'advisory', 'off']) {
			const { ruleView } = setupRuleView({ extra: { severity } });

			const parsed = StandardsRuleView.parse(ruleView);

			// unlike a persisted finding, a rule row may sit at `off`: that is exactly
			// what a repo configured, and the view still shows the rule it switched off
			expect(parsed.severity).toBe(severity);
		}
	});

	test('rejects a severity outside the three configured states', () => {
		for (const severity of ['warning', 'Blocking', 'disabled']) {
			const { ruleView } = setupRuleView({ extra: { severity } });

			const result = StandardsRuleView.safeParse(ruleView);

			expect(result.success).toBe(false);
		}
	});

	test('a rule the repo overrode is marked as coming from config', () => {
		const { ruleView } = setupRuleView({ extra: { fromConfig: true, severity: 'off' } });

		const parsed = StandardsRuleView.parse(ruleView);

		// the flag is what lets a reader tell a repo's own decision from the package's
		// default, so it survives the boundary beside the severity it explains
		expect(parsed).toEqual(expect.objectContaining({ fromConfig: true, severity: 'off' }));
	});

	test('rejects the two flags given as strings rather than coercing them', () => {
		for (const extra of [{ checked: 'true' }, { fromConfig: 'false' }]) {
			const { ruleView } = setupRuleView({ extra });

			const result = StandardsRuleView.safeParse(ruleView);

			// 'false' is truthy — coercing here would report an unchecked rule as
			// checked and a package default as a repo override
			expect(result.success).toBe(false);
		}
	});

	test('a rule with no tunable settings parses with an empty settings map', () => {
		const { ruleView } = setupRuleView({ extra: { settings: {} } });

		const parsed = StandardsRuleView.parse(ruleView);

		// most rules take no numbers at all; the map is required but not non-empty
		expect(parsed.settings).toStrictEqual({});
	});

	test('every setting a repo tuned is kept under its own key', () => {
		const { ruleView } = setupRuleView({ extra: { settings: { maxLines: 250, minTokens: 60 } } });

		const parsed = StandardsRuleView.parse(ruleView);

		// the map is open by key — a package names its own settings, and the view
		// shows whichever ones this repo set
		expect(parsed.settings).toStrictEqual({ maxLines: 250, minTokens: 60 });
	});

	test('rejects a setting whose value is not a number', () => {
		for (const settings of [{ maxLines: '400' }, { maxLines: true }, { maxLines: null }]) {
			const { ruleView } = setupRuleView({ extra: { settings } });

			const result = StandardsRuleView.safeParse(ruleView);

			// settings are thresholds a check compares against — only numbers are
			// comparable
			expect(result.success).toBe(false);
		}
	});

	test('rejects a settings value that is not a map at all', () => {
		const { ruleView } = setupRuleView({ extra: { settings: [['maxLines', 400]] } });

		const result = StandardsRuleView.safeParse(ruleView);

		expect(result.success).toBe(false);
	});

	test('the rule identity and document fields are each required', () => {
		for (const field of ['rule', 'doc', 'documentPath', 'set', 'summary', 'prose', 'checked', 'severity', 'fromConfig', 'settings']) {
			const { ruleView } = setupRuleView({ omit: field });

			const result = StandardsRuleView.safeParse(ruleView);

			// ${field} is rendered or linked to directly — the row is the whole answer
			// to "what is this rule and how does this repo run it"
			expect(result.success).toBe(false);
		}
	});

	test('the finding count and the history block are each required', () => {
		for (const field of ['findingCount', 'history']) {
			const { ruleView } = setupRuleView({ omit: field });

			const result = StandardsRuleView.safeParse(ruleView);

			// a rule with nothing open reports zero and an empty history rather than
			// omitting either — an absent count would render as blank, not as clean
			expect(result.success).toBe(false);
		}
	});

	test('every count inside the history block is required', () => {
		for (const field of ['attempted', 'resolved', 'declined', 'untracked', 'adviceApplied', 'adviceDeclined', 'reasons']) {
			const { ruleView } = setupRuleView();
			const history = { ...(ruleView.history as Record<string, unknown>) };
			delete history[field];
			ruleView.history = history;

			const result = StandardsRuleView.safeParse(ruleView);

			// ${field} is one tally of what the refactor pipeline recorded against this
			// rule; a missing one would silently read as zero attempts
			expect(result.success).toBe(false);
		}
	});

	test('rejects a history count given as a numeric string', () => {
		const { ruleView } = setupRuleView({
			extra: {
				history: { attempted: '5', resolved: 4, declined: 1, untracked: 0, adviceApplied: 2, adviceDeclined: 1, reasons: [] },
			},
		});

		const result = StandardsRuleView.safeParse(ruleView);

		expect(result.success).toBe(false);
	});

	test('rejects a decline reason that is not a string', () => {
		const { ruleView } = setupRuleView({
			extra: {
				history: { attempted: 1, resolved: 0, declined: 1, untracked: 0, adviceApplied: 0, adviceDeclined: 0, reasons: [{ text: 'schema' }] },
			},
		});

		const result = StandardsRuleView.safeParse(ruleView);

		// the reasons are printed verbatim as the agent's own words
		expect(result.success).toBe(false);
	});

	test('every decline reason is kept in the order the runs recorded them', () => {
		const { ruleView } = setupRuleView({
			extra: {
				history: {
					attempted: 3,
					resolved: 1,
					declined: 2,
					untracked: 0,
					adviceApplied: 0,
					adviceDeclined: 0,
					reasons: ['the span is a schema, not duplication', 'splitting it would break the public surface'],
				},
			},
		});

		const parsed = StandardsRuleView.parse(ruleView);

		expect(parsed.history.reasons).toStrictEqual(['the span is a schema, not duplication', 'splitting it would break the public surface']);
	});

	test('keys the contract does not declare are stripped from the row and from its history', () => {
		const { ruleView } = setupRuleView({
			extra: {
				findings: [{ rule: 'size-file' }],
				history: { attempted: 1, resolved: 1, declined: 0, untracked: 0, adviceApplied: 0, adviceDeclined: 0, reasons: [], batches: 2 },
			},
		});

		const parsed = StandardsRuleView.parse(ruleView);

		// the row carries counts and prose, never the findings themselves — those
		// live once on the view, not copied onto every rule
		expect(parsed).toEqual(
			expect.objectContaining({
				history: { attempted: 1, resolved: 1, declined: 0, untracked: 0, adviceApplied: 0, adviceDeclined: 0, reasons: [] },
			}),
		);
		expect(parsed).not.toHaveProperty('findings');
	});

	test('rejects a finding count given as a numeric string rather than coercing it', () => {
		const { ruleView } = setupRuleView({ extra: { findingCount: '3' } });

		const result = StandardsRuleView.safeParse(ruleView);

		// the count is summed into the header and compared against zero to decide
		// whether a rule reads as clean — a string would compare as text
		expect(result.success).toBe(false);
	});

	test('a rule id a third-party package declares parses — rule identity is not a closed list', () => {
		const { ruleView } = setupRuleView({
			extra: { rule: 'acme-no-barrel-imports', doc: '@acme/standards: code/acme-no-barrel-imports', documentPath: 'code/acme-no-barrel-imports' },
		});

		const parsed = StandardsRuleView.parse(ruleView);

		// rule identity belongs to the loaded packages, so a row carries whatever id
		// the package stating the rule named its folder — the engine closes neither list
		expect(parsed).toEqual(
			expect.objectContaining({
				rule: 'acme-no-barrel-imports',
				doc: '@acme/standards: code/acme-no-barrel-imports',
				documentPath: 'code/acme-no-barrel-imports',
			}),
		);
	});
});
