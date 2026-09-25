interface Params {
	/** The `--name` value exactly as the user gave it. */
	name: string;
	/** What the address would have named, completing 'so there is no …' — e.g. 'plan to act on'. */
	missing: string;
}

/**
 * The one sentence a command answers with when its `--name` is not a plan
 * address.
 *
 * Every plan of a work order lives at `<work-order-name>/<plan-id>`, so a bare
 * folder name names no plan at all. It lives here rather than in either command
 * because the two that refuse it differ only in what the address would have
 * named — and two spellings of one refusal would soon state two different
 * address shapes.
 */
export const describeMissingPlanAddress = ({ name, missing }: Params): string =>
	`'${name}' is not a plan address, so there is no ${missing} — a plan of a work order is addressed as '<work-order-name>/<plan-id>', and \`lightsout work-order show --name ${name}\` lists the plans that work order holds`;
