/** Why a coordinator's gates and agent panels are empty: its phases each ran their own. */
export const CoordinatorNote = () => (
	<p className="rounded-lg border border-border bg-card px-4 py-3 text-muted-foreground text-sm">
		A coordinator runs no gates and spends nothing of its own — each phase's child run has its own.
	</p>
);
