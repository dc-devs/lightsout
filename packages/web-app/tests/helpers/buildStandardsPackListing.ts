import type { StandardsPackListing } from '@lightsout/engine';

interface Params {
	name?: string;
	description?: string;
	isDefault?: boolean;
	built?: boolean;
	path?: string;
	channels?: string[];
	totals?: Partial<StandardsPackListing['totals']>;
	/** Applied last, so a test can drop an optional field the defaults fill — `{ description: undefined }`. */
	overrides?: Partial<StandardsPackListing>;
}

/** One pack's row, as `listStandardsPacks` hands it back for an ordinary authored pack. */
export const buildStandardsPackListing = ({
	name = 'lightsout-defaults',
	description = 'The default TypeScript pack.',
	isDefault = true,
	built = false,
	path = 'packages/standards-typescript',
	channels = ['base', 'react'],
	totals = {},
	overrides = {},
}: Params = {}): StandardsPackListing => ({
	name,
	description,
	isDefault,
	rootPath: `/repos/lightsout/${path}`,
	path,
	built,
	channels,
	totals: { rules: 111, checked: 52, judgment: 59, documents: 24, withFixtures: 111, ...totals },
	...overrides,
});
