// The bundled authored default pack arrives as data, not as a type. Declared
// `unknown` on purpose: `resolveJsonModule` would have TypeScript infer a
// literal type for a third of a megabyte of prose and fixture text, which costs
// seconds on every `tsc` run and buys nothing — `getDefaultPackBundle` parses it
// against `StandardsPackBundle` on the way in, which is the contract that holds.
declare module '#assets/default-pack.json' {
	const bundle: unknown;
	export default bundle;
}
