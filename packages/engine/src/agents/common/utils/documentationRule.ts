import type { ConfigDocs } from '#src/contracts/index.ts';

interface Params {
	docs?: ConfigDocs;
}

/**
 * The template's `documentationRule` token: the rule a repository's own config
 * adds to the fixed set, or nothing at all. Always substituted, including with
 * the empty string — a template that reached an agent still carrying a token is
 * what the plan lint's unresolved-token scan is there to catch.
 */
export const documentationRule = ({ docs }: Params): string =>
	docs === undefined || docs.length === 0
		? ''
		: `- **Documentation stated.** Every IMPLEMENTABLE variant — a Single Plan, and
  each Phase Plan — carries a \`## Documentation\` section, placed immediately
  after \`## Global Constraints\`. An Overview Plan never carries it: the overview
  creates nothing, so a claim written there would belong to no executor. Its
  content is either the declared documents this plan touches, each named in a
  backticked span and each also listed under one of the file headings, or the
  exact sentence \`Nothing user-facing — no docs needed.\` The repository's
  declared documents, and what each covers, are named in your draft input.`;
