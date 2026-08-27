import { describe, expect, jest, test } from '@jest/globals';
import type { ConfigView, FrictionRecord, PlanWorkspaceListing, RunListing, StandardsView } from '@lightsout/engine';
import { PlanStage, RunStatus } from '@lightsout/engine/contracts';
import { screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RepoHealth } from '#src/features/repo/index.ts';
import { buildConfigView } from '#tests/helpers/buildConfigView.ts';
import { buildFrictionRecord } from '#tests/helpers/buildFrictionRecord.ts';
import { buildPlanWorkspaceListing } from '#tests/helpers/buildPlanWorkspaceListing.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { buildStandardsRuleView } from '#tests/helpers/buildStandardsRuleView.ts';
import { buildStandardsView } from '#tests/helpers/buildStandardsView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Standards, friction and config reach this page through `useQuery`, so an
// unseeded one of them would run its real server function and read the
// filesystem. A query left hanging here is the pending state the tiles answer
// with a dash; a rejected one is the unreadable config the strip answers with a
// chip.
const mockGetStandards = jest.fn<() => Promise<StandardsView>>();
const mockGetFriction = jest.fn<() => Promise<FrictionRecord[]>>();
const mockGetConfig = jest.fn<() => Promise<ConfigView>>();
const mockListPlans = jest.fn<() => Promise<PlanWorkspaceListing[]>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({
		getStandards: () => mockGetStandards(),
		getFriction: () => mockGetFriction(),
		getConfig: () => mockGetConfig(),
		listPlanWorkspaces: () => mockListPlans(),
	}),
}));
// -------------------------
jest.mock('@tanstack/react-router', () => ({
	Link: ({
		to,
		params,
		search,
		children,
		className,
	}: {
		to: string;
		params?: Record<string, string>;
		search?: Record<string, string>;
		children: ReactNode;
		className?: string;
	}) => {
		const path = Object.entries(params ?? {}).reduce((resolved, [name, value]) => resolved.replace(`$${name}`, value), to);
		const query = new URLSearchParams(search ?? {}).toString();

		return (
			<a href={query === '' ? path : `${path}?${query}`} className={className}>
				{children}
			</a>
		);
	},
}));
// -------------------------

/** A query that never answers — how this file holds a subscription the page is built to render without. */
const neverAnswers = <TData,>(): Promise<TData> => new Promise<TData>(() => {});

const millisecondsPerDay = 24 * 60 * 60 * 1000;

/** A timestamp inside or outside the page's trailing week, stated in days rather than as a fixed date. */
const daysAgo = ({ days }: { days: number }) => new Date(Date.now() - days * millisecondsPerDay).toISOString();

interface SetupParams {
	runs?: RunListing[];
	/** `null` leaves the standards query pending, which is a repo that has never run a check. */
	standards?: StandardsView | null;
	friction?: FrictionRecord[] | null;
	config?: ConfigView | null;
	/** A `lightsout.config.json` that exists and will not parse — the one state the strip says out loud. */
	configFails?: boolean;
	/** `null` leaves the plans query pending, which is what a repo whose plans have not arrived shows. */
	plans?: PlanWorkspaceListing[] | null;
}

const setupRepoHealth = ({
	runs = [buildRunListing()],
	standards = null,
	friction = null,
	config = buildConfigView(),
	configFails = false,
	plans = null,
}: SetupParams = {}) => {
	mockGetStandards.mockReturnValue(neverAnswers());
	mockGetFriction.mockReturnValue(neverAnswers());
	mockListPlans.mockReturnValue(neverAnswers());

	if (configFails) {
		mockGetConfig.mockRejectedValue(new Error('gates: expected object, received string'));
	} else {
		mockGetConfig.mockReturnValue(neverAnswers());
	}

	renderWithQueryClient({
		ui: <RepoHealth />,
		seed: [
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: '/repos/lightsout' } },
			{ queryKey: [QueryKey.Runs], data: runs },
			...(standards === null ? [] : [{ queryKey: [QueryKey.Standards], data: standards }]),
			...(friction === null ? [] : [{ queryKey: [QueryKey.Friction], data: friction }]),
			...(config === null || configFails ? [] : [{ queryKey: [QueryKey.Config], data: config }]),
			...(plans === null ? [] : [{ queryKey: [QueryKey.PlanWorkspaces], data: plans }]),
		],
	});
};

/** One tile, read by the words under its number rather than by its position in the grid. */
const readTile = ({ label }: { label: string }) => within(screen.getByText(label).parentElement as HTMLElement);

/** The bars, read inside their own panel, since every other link on the page is a run. */
const readTopRules = () =>
	within(screen.getByRole('heading', { level: 3, name: 'Top rules by findings' }).closest('section') as HTMLElement)
		.queryAllByRole('link')
		.map((link) => ({ rule: link.firstElementChild?.textContent, count: link.lastElementChild?.textContent, href: link.getAttribute('href') }));

describe('RepoHealth repo strip', () => {
	test('says what this repo runs agents with, as the file states it', () => {
		setupRepoHealth({ config: buildConfigView({ overrides: { harness: 'codex', model: 'gpt-5' } }) });

		expect(screen.getByText('codex')).toBeInTheDocument();
		expect(screen.getByText('gpt-5')).toBeInTheDocument();
	});

	test('drops the chip a config states nothing for, rather than inventing the fallback a run would resolve', () => {
		setupRepoHealth({ config: buildConfigView({ overrides: { harness: 'codex', model: null } }) });

		expect(screen.getByText('codex')).toBeInTheDocument();
		expect(screen.queryByText('claude-opus-5')).not.toBeInTheDocument();
	});

	test('sends a reader to the page holding the message when the config will not parse, and costs them nothing else', async () => {
		setupRepoHealth({ configFails: true });

		const chip = await screen.findByRole('link', { name: 'config unreadable' });

		expect(chip).toHaveAttribute('href', '/repo/config');
		expect(screen.getByRole('heading', { level: 1, name: 'Health' })).toBeInTheDocument();
	});

	test('says when this repo last did anything, and how it went', () => {
		setupRepoHealth({ runs: [buildRunListing({ status: RunStatus.Failed, updatedAt: daysAgo({ days: 2 }) })] });

		const segment = screen.getByText(/^last run .* · failed$/);

		expect(segment).toBeInTheDocument();
	});

	test('reads the coordinator as the last run rather than whichever phase finished last', () => {
		setupRepoHealth({
			runs: [
				buildRunListing({ runId: 'aaaaaaaa11111111', status: RunStatus.Passed, parentRunId: 'bbbbbbbb22222222', updatedAt: daysAgo({ days: 1 }) }),
				buildRunListing({ runId: 'bbbbbbbb22222222', status: RunStatus.Escalated, updatedAt: daysAgo({ days: 2 }) }),
			],
		});

		const segment = screen.getByText(/^last run .* · escalated$/);

		expect(segment).toBeInTheDocument();
	});

	test('says a configured repo has not run yet, rather than putting a bare dash beside its path', () => {
		setupRepoHealth({ runs: [] });

		const segment = screen.getByText('no runs yet');

		expect(segment).toBeInTheDocument();
	});
});

describe('RepoHealth tiles', () => {
	test('draws a dash where no check has run, because that is a different fact from nothing being broken', () => {
		setupRepoHealth({ standards: null, friction: null });

		expect(readTile({ label: 'blocking findings' }).getByText('—')).toBeInTheDocument();
		expect(readTile({ label: 'advisory findings' }).getByText('—')).toBeInTheDocument();
		expect(readTile({ label: 'friction this week' }).getByText('—')).toBeInTheDocument();
	});

	test('reports the findings the engine counted once a check has run', () => {
		setupRepoHealth({
			standards: buildStandardsView({ overrides: { totals: { rules: 4, checked: 4, judgment: 0, blocking: 7, advisory: 2, orphans: 0 } } }),
		});

		expect(readTile({ label: 'blocking findings' }).getByText('7')).toBeInTheDocument();
		expect(readTile({ label: 'advisory findings' }).getByText('2')).toBeInTheDocument();
	});

	test('draws the recent blocking trend as a line, so a reader sees a direction rather than one number', () => {
		setupRepoHealth({
			standards: buildStandardsView({
				overrides: {
					trend: [
						{ at: '2026-01-01T00:00:00.000Z', path: '.', total: 10, blocking: 9, advisory: 1, byRule: [] },
						{ at: '2026-01-02T00:00:00.000Z', path: '.', total: 5, blocking: 4, advisory: 1, byRule: [] },
					],
				},
			}),
		});

		const line = screen.getByRole('img', { name: 'Recent trend' });

		expect(line).toBeInTheDocument();
	});

	test('draws no line from a single snapshot, which is a point rather than a direction', () => {
		setupRepoHealth({
			standards: buildStandardsView({ overrides: { trend: [{ at: '2026-01-01T00:00:00.000Z', path: '.', total: 10, blocking: 9, advisory: 1, byRule: [] }] } }),
		});

		const line = screen.queryByRole('img', { name: 'Recent trend' });

		expect(line).not.toBeInTheDocument();
	});

	test('draws a run of zeroes flat along the floor, since there is no peak to measure it against', () => {
		setupRepoHealth({
			standards: buildStandardsView({
				overrides: {
					trend: [
						{ at: '2026-01-01T00:00:00.000Z', path: '.', total: 0, blocking: 0, advisory: 0, byRule: [] },
						{ at: '2026-01-02T00:00:00.000Z', path: '.', total: 0, blocking: 0, advisory: 0, byRule: [] },
					],
				},
			}),
		});

		const line = screen.getByRole('img', { name: 'Recent trend' }).querySelector('path');

		expect(line).toHaveAttribute('d', 'M0.0000,1.0000 L1.0000,1.0000');
	});

	test('counts the week’s top-level runs, leaving out both the phase children and last month', () => {
		setupRepoHealth({
			runs: [
				buildRunListing({ runId: 'aaaaaaaa11111111', updatedAt: daysAgo({ days: 1 }) }),
				buildRunListing({ runId: 'bbbbbbbb22222222', updatedAt: daysAgo({ days: 2 }), parentRunId: 'aaaaaaaa11111111' }),
				buildRunListing({ runId: 'cccccccc33333333', updatedAt: daysAgo({ days: 30 }) }),
			],
		});

		const tile = readTile({ label: 'runs this week' });

		expect(tile.getByText('1')).toBeInTheDocument();
	});

	test('says how that week’s runs ended, in the words the badges use', () => {
		setupRepoHealth({
			runs: [
				buildRunListing({ runId: 'aaaaaaaa11111111', status: RunStatus.Passed, updatedAt: daysAgo({ days: 1 }) }),
				buildRunListing({ runId: 'bbbbbbbb22222222', status: RunStatus.Passed, updatedAt: daysAgo({ days: 2 }) }),
				buildRunListing({ runId: 'cccccccc33333333', status: RunStatus.Failed, updatedAt: daysAgo({ days: 3 }) }),
			],
		});

		const split = screen.getByText('2 passed · 1 failed');

		expect(split).toBeInTheDocument();
	});

	test('sums the week’s spend over every run, since a phase’s cost is recorded on the phase', () => {
		setupRepoHealth({
			runs: [
				buildRunListing({ runId: 'aaaaaaaa11111111', costUsd: 1.5, updatedAt: daysAgo({ days: 1 }) }),
				buildRunListing({ runId: 'bbbbbbbb22222222', costUsd: 2.25, parentRunId: 'aaaaaaaa11111111', updatedAt: daysAgo({ days: 1 }) }),
				buildRunListing({ runId: 'cccccccc33333333', costUsd: 9, updatedAt: daysAgo({ days: 40 }) }),
			],
		});

		const tile = readTile({ label: 'spend this week' });

		expect(tile.getByText('$3.75')).toBeInTheDocument();
	});

	test('reads a run whose driver reported no cost as nothing spent rather than as a broken tile', () => {
		setupRepoHealth({ runs: [buildRunListing({ updatedAt: daysAgo({ days: 1 }) })] });

		const tile = readTile({ label: 'spend this week' });

		expect(tile.getByText('$0.00')).toBeInTheDocument();
	});

	test('counts only the friction recorded inside the week', () => {
		setupRepoHealth({
			friction: [
				buildFrictionRecord({ at: daysAgo({ days: 1 }) }),
				buildFrictionRecord({ at: daysAgo({ days: 6 }) }),
				buildFrictionRecord({ at: daysAgo({ days: 20 }) }),
			],
		});

		const tile = readTile({ label: 'friction this week' });

		expect(tile.getByText('2')).toBeInTheDocument();
	});

	test('counts every plan a passed run has not implemented, and sends the reader to them', () => {
		setupRepoHealth({
			plans: [
				buildPlanWorkspaceListing({ name: 'shipped', stage: PlanStage.Implemented }),
				buildPlanWorkspaceListing({ name: 'graded', stage: PlanStage.Graded }),
				buildPlanWorkspaceListing({ name: 'rough', stage: PlanStage.NotesOnly }),
			],
		});

		const tile = readTile({ label: 'open plans' });

		expect(tile.getByRole('link', { name: '2' })).toHaveAttribute('href', '/repo/plans');
	});

	test('holds the open-plans tile at a dash while the plans are still loading, since no plans and none read yet are different facts', () => {
		setupRepoHealth({ standards: buildStandardsView(), friction: [] });

		const tile = readTile({ label: 'open plans' });

		expect(tile.getByText('—')).toBeInTheDocument();
	});
});

describe('RepoHealth top rules panel', () => {
	test('is not mounted at all while no check has answered, rather than drawing an empty panel', () => {
		setupRepoHealth({ standards: null });

		const heading = screen.queryByRole('heading', { name: 'Top rules by findings' });

		expect(heading).not.toBeInTheDocument();
	});

	test('ranks the rules a repo is breaking most, worst first', () => {
		setupRepoHealth({
			standards: buildStandardsView({
				overrides: {
					rules: [
						buildStandardsRuleView({ rule: 'loose-file', findingCount: 3 }),
						buildStandardsRuleView({ rule: 'size-file', findingCount: 11 }),
						buildStandardsRuleView({ rule: 'naming-boolean', findingCount: 7 }),
					],
				},
			}),
		});

		const bars = readTopRules();

		expect(bars.map((bar) => bar.rule)).toStrictEqual(['size-file', 'naming-boolean', 'loose-file']);
		expect(bars.map((bar) => bar.count)).toStrictEqual(['11 findings', '7 findings', '3 findings']);
	});

	test('orders two rules tied on count by name, so the same check always draws the same bars', () => {
		setupRepoHealth({
			standards: buildStandardsView({
				overrides: {
					rules: [buildStandardsRuleView({ rule: 'size-file', findingCount: 4 }), buildStandardsRuleView({ rule: 'loose-file', findingCount: 4 })],
				},
			}),
		});

		const bars = readTopRules();

		expect(bars.map((bar) => bar.rule)).toStrictEqual(['loose-file', 'size-file']);
	});

	test('holds that ranking to five, however many rules a repo breaks', () => {
		setupRepoHealth({
			standards: buildStandardsView({
				overrides: { rules: Array.from({ length: 8 }, (_, index) => buildStandardsRuleView({ rule: `rule-${index}`, findingCount: index + 1 })) },
			}),
		});

		const bars = readTopRules();

		expect(bars).toHaveLength(5);
	});

	test('points a bar at the findings table, already narrowed to the rule it counted', () => {
		setupRepoHealth({ standards: buildStandardsView({ overrides: { rules: [buildStandardsRuleView({ rule: 'size-file', findingCount: 4 })] } }) });

		const [bar] = readTopRules();

		expect(bar.href).toBe('/repo/standards?rule=size-file');
	});

	test('says a check came back clean rather than drawing five bars of nothing', () => {
		setupRepoHealth({
			standards: buildStandardsView({
				overrides: { rules: [buildStandardsRuleView({ rule: 'size-file', findingCount: 0 }), buildStandardsRuleView({ rule: 'loose-file', findingCount: 0 })] },
			}),
		});

		expect(screen.getByText('No findings.')).toBeInTheDocument();
		expect(readTopRules()).toStrictEqual([]);
	});
});
