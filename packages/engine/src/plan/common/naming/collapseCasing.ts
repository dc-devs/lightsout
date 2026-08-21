interface Params {
	/** An export or file name. */
	name: string;
}

/**
 * A name collapsed to bare lowercase alphanumerics — the component+route
 * exemption. Two names identical up to casing/separators (`GetStarted` vs
 * `get-started`) are a framework pair, not a synonym clash.
 *
 * @mirrors packages/standards-typescript/common/naming/collapseCasing.ts
 */
export const collapseCasing = ({ name }: Params): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');
