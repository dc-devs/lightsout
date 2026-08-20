// The type half of the markdown-as-text rule the Vite plugin and the Jest
// transformer both implement. Declared again here rather than reached across
// the package boundary: a .d.ts inside another package's `include` is invisible
// to this one.
declare module '*.md' {
	const content: string;
	export default content;
}
