import type { ReactNode } from 'react';

interface Props {
	children: ReactNode;
}

/** The banner a run or a step gets when something went wrong — one place, so the two sites cannot drift apart. */
export const FailureNotice = ({ children }: Props) => (
	<p className="rounded-md border border-status-failed-border bg-status-failed-light px-3 py-2 text-sm text-status-failed">{children}</p>
);
