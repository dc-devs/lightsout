import { expect, test } from '@jest/globals';
import { LightsoutConfig } from '#src/contracts/index.ts';

const base = { gates: { check: 'c', test: 't', 'test-coverage': false } };

// The block contracts — Gates, PackageGates, ConfigCommands,
// StandardsCheckOverrides — each pin their own shape in their own test. What
// this file owns is the composed config: which blocks are required, which are
// optional, and the top-level fields. The retired spellings and their refusals
// are the neighbouring `LightsoutConfig.removedKeys` suite.

test('LightsoutConfig: gates is required, and every other block is optional', () => {
	// with no gates block there is nothing to verify a run with
	expect(LightsoutConfig.safeParse({}).success).toBe(false);
	// a config carrying only gates parses — commands, packageGates, and
	// standardsChecks are all opt-in (decision 2: backward compatibility)
	expect(LightsoutConfig.safeParse(base).success).toBe(true);
});

test('LightsoutConfig: each block reaches its own contract, valid and invalid alike', () => {
	// a valid entry in each block parses at the config level…
	const parsed = LightsoutConfig.parse({
		...base,
		commands: { implement: { harness: 'codex' } },
		'package-gates': { check: 'c {package}', test: 't {package}' },
		'standards-checks': { 'duplicate-code-block': 'off' },
	});

	expect(parsed.commands).toStrictEqual({ implement: { harness: 'codex' } });
	expect(parsed['package-gates']).toStrictEqual({ check: 'c {package}', test: 't {package}' });
	expect(parsed['standards-checks']).toStrictEqual({ 'duplicate-code-block': 'off' });

	// …and each block's own refusals fire through the composition, so wiring a
	// block in optional never softened it
	expect(LightsoutConfig.safeParse({ ...base, commands: { implment: {} } }).success).toBe(false);
	expect(LightsoutConfig.safeParse({ ...base, 'package-gates': { check: 'pnpm check', test: 't {package}' } }).success).toBe(false);
	expect(LightsoutConfig.safeParse({ ...base, 'standards-checks': { 'duplicate-code-block': 'warn' } }).success).toBe(false);

	// an absent block leaves no key on the parsed config
	expect('package-gates' in LightsoutConfig.parse(base)).toBe(false);
	expect('standards-checks' in LightsoutConfig.parse(base)).toBe(false);
});

test('LightsoutConfig: the ship block is optional, keeps its own kebab-case spelling, and stays strict through the composition', () => {
	const parsed = LightsoutConfig.parse({
		...base,
		ship: { 'ticket-pattern': '^(?<ticket>lo-(?<number>\\d+))', 'pr-body': 'Closes LO-{number}', 'merge-method': 'squash', 'after-implement': true },
	});

	// the block survives parsing as the file wrote it — nothing renames a key on
	// the way through
	expect(parsed.ship).toStrictEqual({
		'ticket-pattern': '^(?<ticket>lo-(?<number>\\d+))',
		'pr-body': 'Closes LO-{number}',
		'merge-method': 'squash',
		'after-implement': true,
	});

	// the block's own strictness fires through the composition: a typoed key here
	// would silently disable a setting the file believes is on
	expect(LightsoutConfig.safeParse({ ...base, ship: { 'ticket-patern': '^(?<ticket>lo-\\d+)' } }).success).toBe(false);
	// and a merge method no forge offers is refused before it reaches a command line
	expect(LightsoutConfig.safeParse({ ...base, ship: { 'merge-method': 'fast-forward' } }).success).toBe(false);

	// ship is opt-in: an absent block leaves no key on the parsed config, and the
	// engine's own defaults stand in
	expect('ship' in LightsoutConfig.parse(base)).toBe(false);
});

test('LightsoutConfig: the auto-plan block is optional, keeps its own kebab-case spelling, and stays strict through the composition', () => {
	const parsed = LightsoutConfig.parse({
		...base,
		'auto-plan': { 'propose-before-draft': true, 'implement-on-approval': true, 'auto-approve-plan': false },
	});

	// the block survives parsing as the file wrote it — nothing renames a key on
	// the way through
	expect(parsed['auto-plan']).toStrictEqual({ 'propose-before-draft': true, 'implement-on-approval': true, 'auto-approve-plan': false });

	// the block's own strictness fires through the composition: a typoed key here
	// would silently disable a checkpoint the file believes is removed
	expect(LightsoutConfig.safeParse({ ...base, 'auto-plan': { 'auto-aprove': true } }).success).toBe(false);

	// auto-plan is opt-in: an absent block leaves no key on the parsed config, and
	// the skill's own documented defaults stand in
	expect('auto-plan' in LightsoutConfig.parse(base)).toBe(false);
});

test('LightsoutConfig: the queue block is optional, keeps its own kebab-case spelling, and stays strict through the composition', () => {
	const queue = {
		'planning-status-labels': { 'planning-complete': 'shaped' },
		'max-parallel': 3,
	};

	const parsed = LightsoutConfig.parse({ ...base, queue });

	// the block survives parsing as the file wrote it — every queue convention
	// reaches the drain exactly as the repo spelled it, because the engine spells
	// none of them in source
	expect(parsed.queue).toStrictEqual(queue);

	// the block's own strictness fires through the composition: a typoed key here
	// would silently disable a setting the file believes is on
	expect(LightsoutConfig.safeParse({ ...base, queue: { ...queue, 'max-parralel': 2 } }).success).toBe(false);

	// queue is opt-in: an absent block leaves no key on the parsed config, and a
	// repo that never runs the queue needs none of it
	expect('queue' in LightsoutConfig.parse(base)).toBe(false);
});

test('LightsoutConfig: the ticket-tracker block is optional, keeps its own kebab-case spelling, and stays strict through the composition', () => {
	const tracker = { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' };

	const parsed = LightsoutConfig.parse({ ...base, 'ticket-tracker': tracker });

	// the block survives parsing as the file wrote it — tracker identity is one
	// fact, spelled once, and nothing renames a key on the way through
	expect(parsed['ticket-tracker']).toStrictEqual(tracker);

	// the block's own strictness fires through the composition: a typoed key here
	// would silently disable a setting the file believes is on
	expect(LightsoutConfig.safeParse({ ...base, 'ticket-tracker': { ...tracker, 'api-key-nev': 'X' } }).success).toBe(false);
	// and the provider discriminator reaches the Jira branch rather than letting
	// the two providers' connection fields mix
	expect(
		LightsoutConfig.safeParse({
			...base,
			'ticket-tracker': {
				provider: 'jira',
				'site-url': 'https://example.atlassian.net',
				project: 'LO',
				'api-key-env': 'JIRA_API_TOKEN',
				'api-user-email-env': 'JIRA_ACCOUNT_EMAIL',
			},
		}).success,
	).toBe(true);
	expect(LightsoutConfig.safeParse({ ...base, 'ticket-tracker': { ...tracker, provider: 'github' } }).success).toBe(false);

	// ticket-tracker is opt-in: an absent block leaves no key on the parsed
	// config, and the engine runs with no tracker at all
	expect('ticket-tracker' in LightsoutConfig.parse(base)).toBe(false);
});

test('LightsoutConfig: the docs block is optional, survives the composition entry for entry, and stays strict', () => {
	const docs = [
		{ path: 'README.md', covers: 'The product tour and the index of every other document.' },
		{ path: 'docs/configuration.md', covers: 'Every lightsout.config.json key.' },
	];

	const parsed = LightsoutConfig.parse({ ...base, docs });

	// the block survives parsing as the file wrote it — every declared surface
	// reaches the plan's writer brief and the grade's checker in the order the
	// config listed them, because the engine names none of them in source
	expect(parsed.docs).toStrictEqual(docs);

	// the block's own strictness fires through the composition: a misspelled key
	// here would silently declare a surface with no description
	expect(LightsoutConfig.safeParse({ ...base, docs: [{ path: 'README.md', cover: 'the tour' }] }).success).toBe(false);
	// and its refusal of an empty array fires too — "declared, but nothing" opts
	// into a check that can never fire
	expect(LightsoutConfig.safeParse({ ...base, docs: [] }).success).toBe(false);

	// docs is opt-in: an absent block leaves no key on the parsed config, which is
	// what a repo declaring nothing relies on for no section, no prompt text and
	// no checker spawn
	expect('docs' in LightsoutConfig.parse(base)).toBe(false);
	expect(LightsoutConfig.parse(base).docs).toBe(undefined);
});

test('LightsoutConfig: effort parses at the top level for every level, and an out-of-enum effort fails', () => {
	for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
		// ${effort} is one of the five levels every harness shares
		expect(LightsoutConfig.parse({ ...base, effort }).effort).toBe(effort);
	}

	// a typo is caught when config is read, not after a run has burned a request
	expect(LightsoutConfig.safeParse({ ...base, effort: 'ultra' }).success).toBe(false);
	// effort stays optional — absence means each harness uses its own default
	expect(LightsoutConfig.safeParse(base).success).toBe(true);
});

test('LightsoutConfig: permissions accepts the two settable levels and rejects everything else', () => {
	expect(LightsoutConfig.parse({ ...base, permissions: 'write' }).permissions).toBe('write');
	expect(LightsoutConfig.parse({ ...base, permissions: 'full-access' }).permissions).toBe('full-access');

	// read-only is engine-selected for the supervisor — never a sane choice for a
	// writing role
	expect(LightsoutConfig.safeParse({ ...base, permissions: 'read-only' }).success).toBe(false);

	for (const claudeMode of ['acceptEdits', 'bypassPermissions', 'plan']) {
		// ${claudeMode} is Claude Code's own vocabulary — it used to parse as a free
		// string and now does not
		expect(LightsoutConfig.safeParse({ ...base, permissions: claudeMode }).success).toBe(false);
	}
});

test('LightsoutConfig: coverage-summary-path is optional and parses as the path the coverage tooling writes', () => {
	expect(LightsoutConfig.parse({ ...base, 'coverage-summary-path': 'reports/coverage-summary.json' })['coverage-summary-path']).toBe(
		'reports/coverage-summary.json',
	);
	// absent means the Istanbul default location — every existing config stays valid
	expect(LightsoutConfig.parse(base)['coverage-summary-path']).toBe(undefined);
	// a path is a path: anything else would be read as a file name at run time
	expect(LightsoutConfig.safeParse({ ...base, 'coverage-summary-path': 42 }).success).toBe(false);
});

test('LightsoutConfig: executor-file-limit is optional and parses as the file ceiling the feature executor refuses past', () => {
	// a repo that wants a tighter or looser bound than the shipped default of 50
	// states it here, and the planning checks and the executor then read one number
	expect(LightsoutConfig.parse({ ...base, 'executor-file-limit': 80 })['executor-file-limit']).toBe(80);
	// absent means the engine's own default — every existing config stays valid
	expect(LightsoutConfig.parse(base)['executor-file-limit']).toBe(undefined);
	// and absence leaves no key on the parsed config, unlike an explicit value
	expect('executor-file-limit' in LightsoutConfig.parse(base)).toBe(false);
});

test.each([
	{ label: 'an executor-file-limit of 0', value: 0 },
	{ label: 'a negative executor-file-limit', value: -1 },
	{ label: 'an executor-file-limit given as a string', value: '50' },
	{ label: 'a null executor-file-limit', value: null },
	{ label: 'an executor-file-limit object', value: { max: 50 } },
])('LightsoutConfig: $label fails parsing', ({ value }) => {
	// a non-positive ceiling would refuse every plan before it created a single
	// file, and a non-number would be compared against a file count as something
	// other than a number — both are caught when config is read, not mid-run
	expect(LightsoutConfig.safeParse({ ...base, 'executor-file-limit': value }).success).toBe(false);
});

test('LightsoutConfig: standards-packs accepts relative and absolute pack roots, in config order', () => {
	const standardsPacks = ['standards/house', '/opt/acme-standards'];

	const parsed = LightsoutConfig.parse({ ...base, 'standards-packs': standardsPacks });

	// entries are plain strings either way — the schema carries no path-kind
	// discrimination, and order is the order packs stack in
	expect(parsed['standards-packs']).toStrictEqual(standardsPacks);
});

test('LightsoutConfig: standards-packs accepts false and absence', () => {
	const parsed = LightsoutConfig.parse({ ...base, 'standards-packs': false });

	// false is the explicit opt-out, distinct from an absent field
	expect(parsed['standards-packs']).toBe(false);
	// the field stays optional — an absent field means the shipped default pack loads
	expect(LightsoutConfig.safeParse(base).success).toBe(true);
});

test('LightsoutConfig: a non-string standards-packs entry fails parsing', () => {
	// entries are plain strings — an object entry is a hard error
	expect(LightsoutConfig.safeParse({ ...base, 'standards-packs': [{ path: 'standards/house' }] }).success).toBe(false);
	// a bare string in place of the array is a hard error
	expect(LightsoutConfig.safeParse({ ...base, 'standards-packs': 'standards/house' }).success).toBe(false);
});

test('LightsoutConfig: an empty standards-packs array parses and stays empty', () => {
	const parsed = LightsoutConfig.parse({ ...base, 'standards-packs': [] });

	// an array says "exactly these", so an empty one says "exactly none" and must
	// survive parsing as itself — collapsing it to absence would load the shipped
	// default pack the config just declined
	expect(parsed['standards-packs']).toStrictEqual([]);
	// and it is a present key, unlike an absent field
	expect('standards-packs' in parsed).toBe(true);
});

test.each([
	{ label: 'a standards-packs of true', 'standards-packs': true },
	{ label: 'a standards-packs of null', 'standards-packs': null },
	{ label: 'a standards-packs of 0', 'standards-packs': 0 },
	{ label: 'a standards-packs object', 'standards-packs': { roots: ['standards/house'] } },
])('LightsoutConfig: $label fails parsing', ({ 'standards-packs': standardsPacks }) => {
	// the opt-out is the literal false and nothing else — a truthy or nullish value
	// near it would otherwise read as an opt-out and silently drop every standard
	expect(LightsoutConfig.safeParse({ ...base, 'standards-packs': standardsPacks }).success).toBe(false);
});

test('LightsoutConfig: the plan block is optional, keeps its own kebab-case spelling, and stays strict through the composition', () => {
	const parsed = LightsoutConfig.parse({
		...base,
		plan: { contract: true, 'weight-thresholds': { 'created-files': 5, packages: 2 } },
	});

	// the block survives parsing as the file wrote it — nothing renames a key on
	// the way through, so the grade reads the thresholds the repo spelled
	expect(parsed.plan).toStrictEqual({ contract: true, 'weight-thresholds': { 'created-files': 5, packages: 2 } });

	// the block's own strictness fires through the composition, at both levels: a
	// typoed key here would silently leave the contract shape off while the file
	// believes it is on
	expect(LightsoutConfig.safeParse({ ...base, plan: { contracts: true } }).success).toBe(false);
	expect(LightsoutConfig.safeParse({ ...base, plan: { 'weight-thresholds': { 'created-file': 3 } } }).success).toBe(false);
	// and its numeric refusals fire too — a threshold below one would make every
	// plan file heavy
	expect(LightsoutConfig.safeParse({ ...base, plan: { 'weight-thresholds': { packages: 0 } } }).success).toBe(false);

	// plan is opt-in: an absent block leaves no key on the parsed config, which is
	// what a repo relies on for today's template, today's required sections and
	// the reader fleet on every plan file
	expect('plan' in LightsoutConfig.parse(base)).toBe(false);
	expect(LightsoutConfig.parse(base).plan).toBe(undefined);
});
