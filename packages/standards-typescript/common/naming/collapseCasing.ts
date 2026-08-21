interface Params {
	/** An export or file name. */
	name: string;
}

/**
 * A name reduced to bare lowercase alphanumerics — the framework-pair
 * exemption. Two names identical once casing and separators are dropped
 * (`GetStarted` vs `get-started`) are one concept spelled for two conventions,
 * not two names in conflict, so every rule that compares names has to read them
 * as the same name.
 *
 * @mirrors packages/engine/src/plan/common/naming/collapseCasing.ts
 */
export const collapseCasing = ({ name }: Params): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');
