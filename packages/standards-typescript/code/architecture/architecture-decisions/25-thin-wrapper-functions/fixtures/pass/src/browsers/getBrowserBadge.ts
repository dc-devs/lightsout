import { buildVersionedLabel } from '../common/utils/buildVersionedLabel';

interface Params {
	browser: string;
	browserVersion: string;
}

// The call site does the renaming, so there is no second function to keep in
// step with the first.
export const getBrowserBadge = ({ browser, browserVersion }: Params): string =>
	`<span>${buildVersionedLabel({ name: browser, version: browserVersion })}</span>`;
