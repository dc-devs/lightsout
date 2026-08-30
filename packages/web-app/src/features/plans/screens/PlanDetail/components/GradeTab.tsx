import { FindingSeverity, type GradedGap, type GradeReport, type StructuralFinding } from '@lightsout/engine/contracts';
import { Badge, Card, MetadataTag, StatusBadge } from '#src/appUI/index.ts';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';
import { formatRelativeTime } from '#src/common/formatting/formatRelativeTime.ts';
import { planGradeBadgeConfig } from '#src/features/plans/common/constants/planGradeBadgeConfig.ts';

/** One deterministic defect the plan lint found: which check, where, and the exact fix. */
const StructuralRow = ({ finding }: { finding: StructuralFinding }) => (
	<li className="flex flex-col gap-1 border-border border-t pt-2 first:border-t-0 first:pt-0">
		<span className="flex flex-wrap items-center gap-2">
			<Badge variant={finding.severity === FindingSeverity.Blocking ? BadgeVariant.Blocking : BadgeVariant.Advisory}>{finding.check}</Badge>
			<MetadataTag>{finding.phase}</MetadataTag>
			<span className="text-muted-foreground text-xs">{finding.location}</span>
		</span>
		<span>{finding.issue}</span>
		<span className="text-muted-foreground">Fix: {finding.fix}</span>
	</li>
);

/** One place the plan would force the implementing agent to guess, with the decision that closes it. */
const GapRow = ({ gap }: { gap: GradedGap }) => (
	<li className="flex flex-col gap-1 border-border border-t pt-2 first:border-t-0 first:pt-0">
		<span className="flex flex-wrap items-center gap-2">
			<Badge>{gap.area}</Badge>
			<MetadataTag>{gap.phase}</MetadataTag>
			{gap.lens === undefined ? null : <span className="text-muted-foreground text-xs">{gap.lens}</span>}
		</span>
		<span>{gap.gap}</span>
		<span className="text-muted-foreground">Decision: {gap.decision}</span>
		{gap.options.length === 0 ? null : <span className="text-muted-foreground">Options: {gap.options.join(' / ')}</span>}
	</li>
);

interface Props {
	grade?: GradeReport;
}

/** The grade a plan earned, and the evidence behind it — the mechanical findings and the decision gaps. */
export const GradeTab = ({ grade }: Props) => {
	if (grade === undefined) {
		return <p className="text-muted-foreground text-sm">Not graded yet — run lightsout plan grade --name &lt;name&gt;.</p>;
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<StatusBadge status={grade.grade} config={planGradeBadgeConfig} />
				<span className="text-muted-foreground">{grade.passed ? 'passed the bar implement assumes' : 'has not reached the bar implement assumes'}</span>
				<span className="text-muted-foreground">· graded {formatRelativeTime({ at: grade.gradedAt })}</span>
			</div>
			{grade.complete ? null : (
				<p className="text-sm text-status-running">
					This pass did not finish, so the findings below are real but partial{grade.incompleteReason === undefined ? '' : `: ${grade.incompleteReason}`}
				</p>
			)}
			<Card title={`Structural findings (${grade.structural.length})`}>
				{grade.structural.length === 0 ? (
					<p className="text-muted-foreground text-sm">Nothing mechanical is wrong with this plan.</p>
				) : (
					<ul className="flex flex-col gap-2 text-sm">
						{grade.structural.map((finding) => (
							<StructuralRow key={`${finding.phase}:${finding.check}:${finding.location}`} finding={finding} />
						))}
					</ul>
				)}
			</Card>
			<Card title={`Decision gaps (${grade.gaps.length})`}>
				{grade.gaps.length === 0 ? (
					<p className="text-muted-foreground text-sm">Nothing here would make an implementing agent guess.</p>
				) : (
					<ul className="flex flex-col gap-2 text-sm">
						{grade.gaps.map((gap) => (
							<GapRow key={`${gap.phase}:${gap.lens ?? gap.area}:${gap.gap}`} gap={gap} />
						))}
					</ul>
				)}
			</Card>
		</div>
	);
};
