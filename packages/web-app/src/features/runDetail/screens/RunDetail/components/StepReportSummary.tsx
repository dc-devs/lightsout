import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { StepReportKind } from '#src/features/runDetail/common/constants/StepReportKind.ts';
import type { StepReport } from '#src/features/runDetail/common/types/StepReport.ts';

/** A short heading over one block of a report's detail. */
const Section = ({ label, children }: { label: string; children: ReactNode }) => (
	<div className="flex flex-col gap-1">
		<span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
		{children}
	</div>
);

interface Props {
	report: StepReport;
}

/**
 * One step's validated report, rendered by whichever contract it answered to.
 *
 * A report matching none of them is shown as its own JSON rather than hidden:
 * the manifest stores it opaquely, so a shape nobody anticipated is evidence a
 * reader still has to be able to see.
 *
 * Every kind but `Raw` and `Phase` is a stack of blocks, so the branch decides
 * only what those blocks are and the stack itself is written once below them.
 */
export const StepReportSummary = ({ report }: Props) => {
	const isStacked = report.kind !== StepReportKind.Raw && report.kind !== StepReportKind.Phase;
	let content: ReactNode;

	if (report.kind === StepReportKind.Raw) {
		content = <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-5">{report.text}</pre>;
	} else if (report.kind === StepReportKind.Phase) {
		content = (
			<Link to="/repo/runs/$runId" params={{ runId: report.runId }} className="font-mono text-primary text-xs underline underline-offset-2">
				{report.runId.slice(0, 8)}
			</Link>
		);
	} else if (report.kind === StepReportKind.Batch) {
		content = (
			<>
				<p>
					{report.outcome} · {formatCount({ count: report.remaining, noun: 'site' })} still standing
				</p>
				{report.rationale.length === 0 ? null : (
					<Section label="rationale">
						<ul className="list-disc space-y-1 pl-5 text-muted-foreground-strong text-xs">
							{report.rationale.map((line) => (
								<li key={line}>{line}</li>
							))}
						</ul>
					</Section>
				)}
				{report.advisories.length === 0 ? null : (
					<Section label="advisories">
						<ul className="space-y-1 text-muted-foreground-strong text-xs">
							{report.advisories.map((advisory) => (
								<li key={`${advisory.rule}:${advisory.siteKey}`}>
									<span className="font-mono">{advisory.rule}</span> — {advisory.outcome}
									{advisory.reason === undefined ? '' : ` · ${advisory.reason}`}
								</li>
							))}
						</ul>
					</Section>
				)}
			</>
		);
	} else if (report.kind === StepReportKind.Writers) {
		content = (
			<>
				<p>
					{formatCount({ count: report.count, noun: 'writer batch', plural: 'writer batches' })} · {formatCount({ count: report.fileCount, noun: 'file' })} ·{' '}
					{Object.entries(report.statuses)
						.map(([status, count]) => `${status} ${count}`)
						.join(' · ')}
				</p>
				<ul className="list-disc space-y-1 pl-5 text-muted-foreground-strong text-xs">
					{report.summaries.map((summary) => (
						<li key={summary}>{summary}</li>
					))}
				</ul>
			</>
		);
	} else {
		content = (
			<>
				<p>
					{report.status} · {report.summary}
				</p>
				{report.files.length === 0 ? null : (
					<Section label="changed files">
						<ul className="space-y-1 text-muted-foreground-strong text-xs">
							{report.files.map((file) => (
								<li key={file.path}>
									<span className="font-mono">{file.path}</span> — {file.summary}
								</li>
							))}
						</ul>
					</Section>
				)}
				{report.failures.length === 0 ? null : (
					<Section label="failures">
						<ul className="list-disc space-y-1 pl-5 text-status-failed text-xs">
							{report.failures.map((failure) => (
								<li key={failure}>{failure}</li>
							))}
						</ul>
					</Section>
				)}
			</>
		);
	}

	return isStacked ? <div className="flex flex-col gap-3 text-sm">{content}</div> : content;
};
