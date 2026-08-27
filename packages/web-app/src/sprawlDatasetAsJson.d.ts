// The sprawl dataset arrives as data, not as a type. Declared `unknown` on
// purpose: `resolveJsonModule` would have TypeScript infer a literal type for
// every line count in a file of several hundred kilobytes, which costs seconds
// on every `tsc` run and buys nothing — `getSprawlDataset` parses it against
// the `SprawlDataset` schema, which is the contract that actually holds.
declare module '#assets/sprawl-dataset.json' {
	const dataset: unknown;
	export default dataset;
}
