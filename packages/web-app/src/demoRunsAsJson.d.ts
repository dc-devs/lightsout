// The frozen demo runs arrive as data, not as types. Declared `unknown` for the
// reason sprawlDatasetAsJson.d.ts states: `resolveJsonModule` would have
// TypeScript infer a literal type for every field of every step, which costs
// seconds on each `tsc` run and buys nothing — `getDemoRunViews` and
// `getDemoRunListings` parse them against the engine's own contracts, which is
// what actually holds.
declare module '#assets/demo-runs/implement.json' {
	const view: unknown;
	export default view;
}

declare module '#assets/demo-runs/refactor.json' {
	const view: unknown;
	export default view;
}

declare module '#assets/demo-runs/stopped.json' {
	const view: unknown;
	export default view;
}

declare module '#assets/demo-runs/listings.json' {
	const listings: unknown;
	export default listings;
}
