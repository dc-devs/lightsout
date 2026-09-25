interface Params {
	/** The gate as the group labels it, e.g. `test` or `[api] test-coverage`. */
	label: string;
}

/** The line a gate that never returned a verdict is reported with. */
export const describeGateCrash = ({ label }: Params): string =>
	`${label} crashed: on every attempt Jest died without reporting a failing test, so this gate never returned a verdict.`;
