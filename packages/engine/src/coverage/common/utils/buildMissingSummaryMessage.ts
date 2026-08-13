interface Params {
	/** Where the scope's summary was expected. */
	summaryPath: string;
	/** Scope whose coverage command just ran ('root' or a package dir). */
	scope: string;
}

/**
 * The one wording for an unreadable coverage summary, shared by every reader of
 * one — the measurement throws it, the per-file executed check returns it. Both
 * point at the same three fixes `lightsout doctor` validates, so the guidance
 * can never drift between them.
 */
export const buildMissingSummaryMessage = ({ summaryPath, scope }: Params): string =>
	`no readable coverage summary at ${summaryPath} after the ${scope} coverage command ran — configure a json-summary coverage reporter (jest: coverageReporters ['json-summary']) writing that path, or set coverageSummaryPath in lightsout.config.json. \`lightsout doctor\` checks this.`;
