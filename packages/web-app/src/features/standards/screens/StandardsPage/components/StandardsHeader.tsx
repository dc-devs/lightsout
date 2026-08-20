import type { StandardsView } from '@lightsout/engine';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { formatRelativeTime } from '#src/common/formatting/formatRelativeTime.ts';

interface Props {
	view: StandardsView;
}

/**
 * What this repo enforces, when it last looked, and how much is open.
 *
 * A repo that has never run a check is not an error state — the rules are
 * loaded and listed either way — so the whole header collapses to the one
 * command that would fill it in.
 *
 * Every number here is the engine's own. The snapshot's notes are printed as
 * they were written, because they are already full sentences meant for a
 * person: one of them warns that a dominant path may be generated output, and
 * rewording it here would cost the reader that argument.
 */
export const StandardsHeader = ({ view }: Props) => {
	const { totals } = view;

	if (view.at === undefined) {
		return (
			<header className="flex flex-col gap-2">
				<h1 className="font-semibold text-2xl">Standards</h1>
				<p className="text-muted-foreground text-sm">
					{formatCount({ count: totals.rules, noun: 'rule' })} loaded, and no check has been run here yet. Run{' '}
					<code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">lightsout standards-check</code> to take the first snapshot.
				</p>
			</header>
		);
	}

	return (
		<header className="flex flex-col gap-3">
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<h1 className="font-semibold text-2xl">Standards</h1>
				<span className="text-muted-foreground text-sm">
					checked {view.path} · {formatRelativeTime({ at: view.at })}
				</span>
				<span className="font-mono text-muted-foreground text-xs">{view.at}</span>
			</div>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
				<span className="font-medium text-status-failed">{formatCount({ count: totals.blocking, noun: 'blocking finding' })}</span>
				<span className="text-muted-foreground">·</span>
				<span className="text-muted-foreground-strong">{formatCount({ count: totals.advisory, noun: 'advisory finding' })}</span>
				<span className="text-muted-foreground">·</span>
				<span className="text-muted-foreground">
					{formatCount({ count: totals.rules, noun: 'rule' })}, {totals.checked} by code and {totals.judgment} by judgment
				</span>
			</div>
			{totals.orphans === 0 ? null : (
				<p className="text-muted-foreground text-xs">
					{formatCount({ count: totals.orphans, noun: 'finding' })} belong to rules no package loads any more — removed, renamed, or switched off since this
					snapshot was taken.
				</p>
			)}
			{view.notes.map((note) => (
				<p key={note} className="rounded-md border border-border bg-muted px-3 py-2 text-muted-foreground-strong text-xs leading-5">
					{note}
				</p>
			))}
		</header>
	);
};
