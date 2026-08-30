import { expect, test } from '@jest/globals';
import { renderDocsSurfaces } from '#src/agents/common/utils/renderDocsSurfaces.ts';

test('renderDocsSurfaces: one surface renders as a backticked path and its covers line', () => {
	expect(renderDocsSurfaces({ docs: [{ path: 'README.md', covers: 'The product tour.' }] })).toBe('- `README.md` — The product tour.');
});

test('renderDocsSurfaces: several surfaces keep the order the config wrote them in', () => {
	const rendered = renderDocsSurfaces({
		docs: [
			{ path: 'README.md', covers: 'The tour.' },
			{ path: 'docs/configuration.md', covers: 'Every config key.' },
			{ path: 'docs/monorepos.md', covers: 'How a monorepo is configured.' },
		],
	});

	// the config's order is the reading order, so the list is never re-sorted
	expect(rendered).toBe('- `README.md` — The tour.\n- `docs/configuration.md` — Every config key.\n- `docs/monorepos.md` — How a monorepo is configured.');
});

test('renderDocsSurfaces: a covers line carrying a backtick or an em dash is emitted verbatim', () => {
	const rendered = renderDocsSurfaces({ docs: [{ path: 'docs/gates.md', covers: 'The `gates` block — every key it holds.' }] });

	// the engine standardizes the question, never the prose: nothing here escapes
	// or rewrites what the repository wrote
	expect(rendered).toBe('- `docs/gates.md` — The `gates` block — every key it holds.');
});
