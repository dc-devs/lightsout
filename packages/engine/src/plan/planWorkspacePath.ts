interface Params {
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
}

/**
 * A plan workspace addressed the way the repo writes it down: relative to the
 * repo root, with forward slashes, whatever separator this platform joins
 * absolute paths with.
 *
 * This is the spelling a run manifest's `plan` field carries and the one
 * `getPlanDocument` takes, so the code that matches runs to a plan and the code
 * that builds a file's path both ask here instead of writing the prefix twice.
 */
export const planWorkspacePath = ({ name }: Params): string => `.lightsout/plans/${name}`;
