interface Params {
	text: string;
}

/**
 * Command output with anything credential-shaped taken out of it.
 *
 * Ship persists what a command said — into a result file a tracker skill
 * quotes outward, and into the evidence a repair agent is handed — and `git
 * push` stderr can echo a tokenized remote (`https://user:ghp_xxx@github.com/…`).
 * URL userinfo and token-shaped runs are masked here, once, so no caller has to
 * remember to do it.
 */
export const maskSecrets = ({ text }: Params): string =>
	text.replaceAll(/(\/\/)[^\s/@]+(?::[^\s/@]*)?@/g, '$1***@').replaceAll(/\b(gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}\b/g, '***');
