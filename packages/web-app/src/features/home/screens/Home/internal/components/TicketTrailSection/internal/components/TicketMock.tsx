import type { LucideIcon } from 'lucide-react';
import { CircleCheck, FileText, GitMerge, GitPullRequest, Paperclip } from 'lucide-react';
import { LinearMark } from '#src/appUI/icons/LinearMark.tsx';
import { cn } from '#src/common/utils/cn.ts';
import { demoTicket } from '#src/features/home/internal/common/constants/demoTicket.ts';

/** The files a ticket carries once its brainstorm and plan are published — the names lightsout attaches them under. */
const attachments = ['brainstorm-notes.md', 'brainstorm-decisions.json', 'plan.md'];

/** What the ticket's history shows, oldest first, each written by lightsout as the work moves. */
const activity: Array<{ Icon: LucideIcon; text: string; isDone?: boolean }> = [
	{ Icon: Paperclip, text: 'Brainstorm published: design and decisions attached' },
	{ Icon: CircleCheck, text: 'Plan graded A and published' },
	{ Icon: GitPullRequest, text: 'Pull request opened, linked to this ticket' },
	{ Icon: GitMerge, text: 'Merged, ticket closed', isDone: true },
];

/**
 * A ticket as a team would see it after lightsout has worked it: the plan's
 * files attached, the status current, and a history of every step — drawn as
 * a Linear ticket from lightsout's own board, since that is where this
 * project's work is tracked.
 */
export const TicketMock = () => (
	<figure
		aria-label="A ticket with its brainstorm, plan and history attached"
		className="w-full overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-blue-900/10"
	>
		<div className="flex flex-wrap items-center justify-between gap-3 border-border/60 border-b px-6 py-4">
			<p className="flex items-center gap-2 font-mono text-muted-foreground text-xs">
				<LinearMark className="size-4" />
				{demoTicket.key}
			</p>
			<span className="rounded-full border border-status-passed-border bg-status-passed-light px-3 py-1 font-semibold text-status-passed-foreground text-xs">
				Done
			</span>
		</div>
		<div className="flex flex-col gap-6 p-6">
			<p className="font-bold text-drop-navy text-lg">{demoTicket.title}</p>
			<div className="flex flex-col gap-2">
				<p className="font-semibold text-subtle-foreground text-xs uppercase tracking-widest">Attachments</p>
				<ul className="flex flex-wrap gap-2">
					{attachments.map((file) => (
						<li
							key={file}
							className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 font-mono text-muted-foreground-strong text-xs"
						>
							<FileText aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
							{file}
						</li>
					))}
				</ul>
			</div>
			<div className="flex flex-col gap-3">
				<p className="font-semibold text-subtle-foreground text-xs uppercase tracking-widest">Activity</p>
				<ol className="flex flex-col gap-3">
					{activity.map(({ Icon, text, isDone = false }) => (
						<li key={text} className="flex items-center gap-3 text-sm">
							<span
								className={cn(
									'flex size-7 shrink-0 items-center justify-center rounded-full',
									isDone ? 'bg-status-passed-light text-status-passed' : 'bg-primary-tint text-primary',
								)}
							>
								<Icon aria-hidden="true" className="size-3.5" />
							</span>
							<span className="text-muted-foreground-strong">{text}</span>
						</li>
					))}
				</ol>
			</div>
		</div>
	</figure>
);
