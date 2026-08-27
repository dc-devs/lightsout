import type { FrictionRecord, RunListing, StandardsView } from '@lightsout/engine';
import { PlanStage } from '@lightsout/engine/contracts';
import { formatCost } from '@lightsout/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { statusBadgeConfig } from '#src/common/constants/statusBadgeConfig.ts';
import { planWorkspacesQueryOptions } from '#src/features/plans/index.ts';
import { isWithinLastDays } from '#src/features/repo/common/utils/isWithinLastDays.ts';
import { HealthTile } from '#src/features/repo/screens/RepoHealth/components/HealthTile.tsx';
import { Sparkline } from '#src/features/repo/screens/RepoHealth/components/Sparkline.tsx';

/** The window every "recently" on this page means. Trailing from now, so it says one thing in every timezone. */
const windowDays = 7;

/** What the runs tile's second line says: how the week's runs ended, in the words the badges use. */
const describeStatuses = ({ runs }: { runs: RunListing[] }) => {
	const counts = new Map<RunListing['status'], number>();

	for (const run of runs) {
		counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
	}

	return counts.size === 0 ? undefined : [...counts].map(([status, count]) => `${count} ${statusBadgeConfig[status].label}`).join(' · ');
};

interface Props {
	/** Every run, phase children included — the tiles decide per number which of the two they mean. */
	runs: RunListing[];
	/** Absent while the standards query is pending or has failed, which is why the finding tiles can read as a dash. */
	standards?: StandardsView;
	friction?: FrictionRecord[];
}

/**
 * The six numbers a repo owner checks first.
 *
 * A tile whose data has not arrived renders a dash rather than a zero: "no check
 * has run here" and "nothing is broken" are opposite answers, and a zero would
 * give the reassuring one to a repo that has never looked.
 *
 * Run counts and the recent-run split are top-level runs only — one eight-phase
 * implement run is one thing that happened, not nine. Spend is the exception and
 * sums every run including the children, because a coordinator's own `costUsd`
 * covers only its own steps and its phases' spend lives on the phases.
 */
export const HealthTiles = ({ runs, standards, friction }: Props) => {
	const { data: plans } = useQuery(planWorkspacesQueryOptions());
	// Anything a passed run has not implemented is still open work — including a
	// plan whose run failed, which is exactly what this tile should keep counting.
	const openPlans = plans?.filter((plan) => plan.stage !== PlanStage.Implemented).length;
	const topLevel = runs.filter((run) => run.parentRunId === undefined);
	const recentRuns = topLevel.filter((run) => isWithinLastDays({ at: run.updatedAt, days: windowDays }));
	const recentSpend = runs.filter((run) => isWithinLastDays({ at: run.updatedAt, days: windowDays })).reduce((total, run) => total + (run.costUsd ?? 0), 0);
	// Enough points to show a direction, few enough to stay a tile.
	const sparklinePoints = 30;
	const blockingTrend = (standards?.trend ?? []).slice(-sparklinePoints).map((point) => point.blocking);

	return (
		<div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
			<HealthTile label="blocking findings" value={standards === undefined ? '—' : standards.totals.blocking} hint="in the latest snapshot">
				<Sparkline values={blockingTrend} />
			</HealthTile>
			<HealthTile label="advisory findings" value={standards === undefined ? '—' : standards.totals.advisory} hint="worth a look, never blocking" />
			<HealthTile label="runs this week" value={recentRuns.length} hint={describeStatuses({ runs: recentRuns })} />
			<HealthTile label="spend this week" value={formatCost({ usd: recentSpend })} hint="every run, phase children included" />
			<HealthTile
				label="open plans"
				value={
					openPlans === undefined ? (
						'—'
					) : (
						<Link to="/repo/plans" className="hover:underline hover:underline-offset-4">
							{openPlans}
						</Link>
					)
				}
				hint="settled but not yet implemented"
			/>
			<HealthTile
				label="friction this week"
				value={friction === undefined ? '—' : friction.filter((record) => isWithinLastDays({ at: record.at, days: windowDays })).length}
				hint="what agents said got in their way"
			/>
		</div>
	);
};
