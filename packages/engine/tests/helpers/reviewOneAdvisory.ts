import { reviewReport } from '#tests/helpers/reviewReport.ts';

interface Params {
	/** The standards reviewer's system prompt — it lists every judgment rule the loaded packs declare. */
	systemPrompt?: string;
	/** Repo-relative file the advisory is sited on. */
	path: string;
}

/**
 * A standards reviewer stub reporting exactly one advisory, named for a rule the
 * loaded packs really declare — so the engine keeps the finding instead of
 * dropping it as an invented rule id.
 *
 * What a fixture reaches for when its tree is clean but it still needs the
 * bounded cleanup loop to buy its first round: a round is bought only by a
 * qualifying deterministic blocking finding or by an advisory, and a clean tree
 * has neither of its own.
 */
export const reviewOneAdvisory = ({ systemPrompt, path }: Params): string => {
	const rule = /Rule id: `([^`]+)`/.exec(systemPrompt ?? '')?.[1];

	return rule === undefined ? reviewReport() : reviewReport([{ rule, files: [{ path }], detail: 'a judgment call for the cleanup pass' }]);
};
