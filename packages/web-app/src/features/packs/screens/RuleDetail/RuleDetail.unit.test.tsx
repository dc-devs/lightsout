import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsPackRuleView, StandardsRuleView, StandardsView } from '@lightsout/engine';
import { StandardsSeverity } from '@lightsout/engine/contracts';
import { screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RuleDetail } from '#src/features/packs/index.ts';
import { buildStandardsPackRuleView } from '#tests/helpers/buildStandardsPackRuleView.ts';
import { buildStandardsPackView } from '#tests/helpers/buildStandardsPackView.ts';
import { buildStandardsRuleView } from '#tests/helpers/buildStandardsRuleView.ts';
import { buildStandardsView } from '#tests/helpers/buildStandardsView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The trail above the page links back to the packs list and to the pack, and a
// link needs a live router to resolve a path. A plain anchor keeps the
// assertions about where the page points.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------
// The local section subscribes to the standards view rather than suspending on
// it, so a test that leaves that query unanswered would send it at the real
// reader and this repo's own disk. A query left hanging here is the public
// build, where there is no repository to answer with.
const mockGetStandards = jest.fn<() => Promise<StandardsView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getStandards: () => mockGetStandards() }),
}));
// -------------------------

// The local section subscribes to the standards view, so the key is always
// seeded — an unseeded one would send the query at the real reader and this
// repo's own disk. `loadedHere` is what a repo that runs the rule looks like;
// the default is a build with no repo, where the section renders nothing.
const setupRuleDetail = ({ rule = buildStandardsPackRuleView(), loadedHere = false }: { rule?: StandardsPackRuleView; loadedHere?: boolean } = {}) => {
	const pack = buildStandardsPackView();
	const standards = buildStandardsView({
		overrides: { rules: loadedHere ? [buildStandardsRuleView({ rule: rule.id, findingCount: 3, fromConfig: true })] : [] },
	});

	renderWithQueryClient({
		ui: <RuleDetail packName={pack.name} ruleId={rule.id} />,
		seed: [
			{ queryKey: [QueryKey.PackRule, pack.name, rule.id], data: rule },
			{ queryKey: [QueryKey.Pack, pack.name], data: pack },
			{ queryKey: [QueryKey.Standards], data: standards },
		],
	});

	return { pack, rule };
};

/**
 * The page over a repository that loads this rule, arranged around the local row.
 *
 * A second factory rather than another parameter on the first: these vary what
 * the repository does with the rule and never vary the pack's own page. Leaving
 * `here` out is the public build — the standards query never answers, and the
 * section has to be absent rather than empty.
 */
const setupRuleInThisRepo = ({ here }: { here?: StandardsRuleView } = {}) => {
	const rule = buildStandardsPackRuleView();
	const pack = buildStandardsPackView();

	mockGetStandards.mockReturnValue(new Promise<StandardsView>(() => {}));
	renderWithQueryClient({
		ui: <RuleDetail packName={pack.name} ruleId={rule.id} />,
		seed: [
			{ queryKey: [QueryKey.PackRule, pack.name, rule.id], data: rule },
			{ queryKey: [QueryKey.Pack, pack.name], data: pack },
			...(here === undefined ? [] : [{ queryKey: [QueryKey.Standards], data: buildStandardsView({ overrides: { rules: [here] } }) }]),
		],
	});
};

/** The local section alone, since the page above it names a severity and counts of its own. */
const readInThisRepo = () => within(screen.getByRole('heading', { level: 3, name: 'In this repo' }).closest('section') as HTMLElement);

/** One group of counts inside that section, read by the word above it. */
const readCountGroup = ({ title }: { title: string }) =>
	within(readInThisRepo().getByText(title).parentElement as HTMLElement)
		.getAllByRole('listitem')
		.map((item) => item.textContent);

/** The override block the settings card offers, parsed, so the assertion pins the entries rather than the indentation. */
const readOverrideSnippet = (): unknown => JSON.parse(screen.getByText(/"settings"/).textContent ?? '');

describe('RuleDetail', () => {
	test('shows the whole address a reader walked to get here, one step at a time', () => {
		setupRuleDetail();

		const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });

		expect(trail.textContent).toBe('Standards packslightsout-defaultscode/style-guide/typescript/type-assertionstype-assertion');
	});

	test('links the pack step of that trail back to the pack page', () => {
		setupRuleDetail();

		const crumb = screen.getByRole('link', { name: 'lightsout-defaults' });

		expect(crumb).toHaveAttribute('href', '/standards/lightsout-defaults');
	});

	test('names the rule as the page, and says what it catches', () => {
		setupRuleDetail();

		expect(screen.getByRole('heading', { level: 1, name: 'type-assertion' })).toBeInTheDocument();
		expect(screen.getByText('an `as` cast where narrowing would do')).toBeInTheDocument();
	});

	test('says who enforces the rule, how loudly it ships, and where it applies', () => {
		setupRuleDetail();

		expect(screen.getByText('enforced by code')).toBeInTheDocument();
		expect(screen.getByText('blocking by default')).toBeInTheDocument();
		expect(screen.getByText('base')).toBeInTheDocument();
		expect(screen.getByText('code')).toBeInTheDocument();
	});

	test('calls a judgment rule a judgment rule, and says it ships advisory, since much of the pack is both', () => {
		setupRuleDetail({ rule: buildStandardsPackRuleView({ overrides: { checked: false, defaultSeverity: StandardsSeverity.Advisory } }) });

		expect(screen.getByText('judgment')).toBeInTheDocument();
		expect(screen.getByText('advisory by default')).toBeInTheDocument();
	});

	test("prints the rule's own argument, which is what a reader needs in order to disagree with it", () => {
		setupRuleDetail();

		const prose = screen.getByText(/Avoid `as` casts/);

		expect(prose).toBeInTheDocument();
	});

	test('says as much for a rule that argues only through its example, rather than leaving a blank panel', () => {
		setupRuleDetail({ rule: buildStandardsPackRuleView({ prose: '' }) });

		const line = screen.getByText('This rule states its summary and proves it with an example.');

		expect(line).toBeInTheDocument();
	});

	test('shows both sides of the proof', () => {
		setupRuleDetail();

		expect(screen.getByText('return (value as string).toUpperCase();')).toBeInTheDocument();
		expect(screen.getByText(/if \(typeof value === 'string'\)/)).toBeInTheDocument();
	});

	test('lists the numbers a rule ships with, and the block that replaces one', () => {
		setupRuleDetail({ rule: buildStandardsPackRuleView({ id: 'file-size', overrides: { defaultSettings: { maxLines: 250 } } }) });

		expect(screen.getByRole('heading', { name: 'Its numbers' })).toBeInTheDocument();
		expect(readOverrideSnippet()).toStrictEqual({ 'standards-checks': { 'file-size': { settings: { maxLines: 250 } } } });
	});

	test('leaves that card off the rules that ship no numbers, which is most of them', () => {
		setupRuleDetail();

		const card = screen.queryByRole('heading', { name: 'Its numbers' });

		expect(card).not.toBeInTheDocument();
	});

	test('says plainly how a repo turns the rule down, both ways', () => {
		setupRuleDetail();

		expect(screen.getByText('"standards-checks": { "type-assertion": "advisory" }')).toBeInTheDocument();
		expect(screen.getByText('"standards-checks": { "type-assertion": "off" }')).toBeInTheDocument();
	});

	test('offers each of those lines for copying, since they are meant to be pasted rather than retyped', () => {
		setupRuleDetail();

		expect(screen.getByRole('button', { name: /copy advisory/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /copy off/i })).toBeInTheDocument();
	});

	test('says what the repo the app has open does with this rule, and how much is open under it', () => {
		setupRuleDetail({ loadedHere: true });

		expect(screen.getByRole('heading', { name: 'In this repo' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /3 open findings/ })).toHaveAttribute('href', '/repo/standards');
		expect(screen.getByText("set by this repo's config")).toBeInTheDocument();
	});

	test('leaves that section out entirely where no repo is being read, so a public rule page reads as whole', () => {
		setupRuleDetail();

		const section = screen.queryByRole('heading', { name: 'In this repo' });

		expect(section).not.toBeInTheDocument();
	});

	test('leaves that section out while no check has answered yet, which is every rule page in the public build', () => {
		setupRuleInThisRepo();

		const section = screen.queryByRole('heading', { name: 'In this repo' });

		expect(section).not.toBeInTheDocument();
	});

	test('says the rule runs as its pack ships it where this repo\u2019s config never named it', () => {
		setupRuleInThisRepo({ here: buildStandardsRuleView({ rule: 'type-assertion', severity: StandardsSeverity.Advisory, fromConfig: false }) });

		expect(readInThisRepo().getByText('advisory')).toBeInTheDocument();
		expect(readInThisRepo().getByText('as the pack ships it')).toBeInTheDocument();
	});

	test('says a rule this repo turned off is off here, whatever the pack declares', () => {
		setupRuleInThisRepo({ here: buildStandardsRuleView({ rule: 'type-assertion', severity: StandardsSeverity.Off, fromConfig: true }) });

		expect(readInThisRepo().getByText('off')).toBeInTheDocument();
		expect(readInThisRepo().getByText("set by this repo's config")).toBeInTheDocument();
	});

	test('counts what became of the sites a refactor froze, leaving an unfinished batch out of the declines', () => {
		setupRuleInThisRepo({ here: buildStandardsRuleView({ rule: 'type-assertion', history: { attempted: 9, resolved: 6, declined: 1, untracked: 2 } }) });

		const counts = readCountGroup({ title: 'Sites' });

		expect(counts).toStrictEqual(['attempted9', 'resolved6', 'declined1', 'untracked2']);
	});

	test('counts the advice on its own, since an agent\u2019s word for it is not a re-check on disk', () => {
		setupRuleInThisRepo({ here: buildStandardsRuleView({ rule: 'type-assertion', history: { adviceApplied: 4, adviceDeclined: 1, adviceAlreadyMet: 3 } }) });

		const counts = readCountGroup({ title: 'Advice' });

		expect(counts).toStrictEqual(['applied4', 'declined1', 'already met3']);
	});

	test('lists each reason an agent recorded once and on one line, however the manifest wrapped it', () => {
		setupRuleInThisRepo({
			here: buildStandardsRuleView({
				rule: 'type-assertion',
				history: { reasons: ['the cast\n\tguards a parser boundary', 'the cast guards a parser boundary', '   ', 'the file is vendored'] },
			}),
		});

		const reasons = readCountGroup({ title: 'Reasons recorded' });

		expect(reasons).toStrictEqual(['the cast guards a parser boundary', 'the file is vendored']);
	});

	test('leaves the reasons off a rule no agent explained itself over, rather than heading an empty list', () => {
		setupRuleInThisRepo({ here: buildStandardsRuleView({ rule: 'type-assertion', history: { reasons: [] } }) });

		const heading = readInThisRepo().queryByText('Reasons recorded');

		expect(heading).not.toBeInTheDocument();
	});
});
