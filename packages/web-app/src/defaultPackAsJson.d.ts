// The bundled authored default pack, declared `unknown` for the reason
// sprawlDatasetAsJson.d.ts states: it is a third of a megabyte of prose and
// fixture text, and `getDefaultPackBundle` parses it against
// `StandardsPackBundle` on the way in.
declare module '#assets/default-pack.json' {
	const bundle: unknown;
	export default bundle;
}
