import { buildVersionedLabel } from './buildVersionedLabel';

interface Params {
	browser: string;
	browserVersion: string;
}

// Adds nothing but indirection: no validation, no defaults, no error handling —
// only two parameters renamed on their way through.
export const buildBrowserLabel = ({ browser, browserVersion }: Params): string =>
	buildVersionedLabel({ name: browser, version: browserVersion });
