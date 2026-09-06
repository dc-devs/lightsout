/**
 * One promise tail every main-checkout git mutation awaits and replaces.
 *
 * A builder adds a worktree there, the ship lane's merge tail removes one, and
 * a reconciliation removes one too. Those three used to be ordered by the drain
 * itself — merging waited for every build — and now run at the same time, so
 * this chain is what keeps them off each other.
 *
 * The tail catches, so one failed task cannot poison the chain for whatever is
 * queued behind it.
 */
export const createMainCheckoutSerializer = (): (<Result>(params: { task: () => Promise<Result> }) => Promise<Result>) => {
	let tail: Promise<unknown> = Promise.resolve();

	return <Result>({ task }: { task: () => Promise<Result> }): Promise<Result> => {
		const next = tail.then(task, task);

		tail = next.catch(() => undefined);

		return next;
	};
};
