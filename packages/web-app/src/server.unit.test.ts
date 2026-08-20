import { describe, expect, jest, test } from '@jest/globals';

// Mocked Imports
// -------------------------
// Both Start subpaths reach a stub through the config's moduleNameMapper, since
// neither publishes a `require` condition. Mocking them here is what makes the
// entry's only decision — which handler renders a request, and what the server
// is finally handed — something a test can read back.
const mockCreateStartHandler = jest.fn<(streamHandler: unknown) => unknown>();
const mockDefaultStreamHandler = () => null;

jest.mock('@tanstack/react-start/server', () => ({
	createStartHandler: (streamHandler: unknown) => mockCreateStartHandler(streamHandler),
	defaultStreamHandler: mockDefaultStreamHandler,
}));
// -------------------------
const mockCreateServerEntry = jest.fn<(params: { fetch: unknown }) => unknown>();

jest.mock('@tanstack/react-start/server-entry', () => ({
	createServerEntry: (params: { fetch: unknown }) => mockCreateServerEntry(params),
}));
// -------------------------

/**
 * Load the server entry and report what it wired to what.
 *
 * The module acts the moment it is imported, so importing it is the act — hence
 * `isolateModules`, which gives every test a module registry of its own and so a
 * genuinely fresh run of those two lines. The two sentinels stand in for values
 * only Start can build, which is what lets each test name one identity and
 * assert it arrived where the app put it.
 */
const setupServerEntry = () => {
	const handleRequest = () => 'the response';
	const serverEntry = { name: 'the server entry' };

	mockCreateStartHandler.mockReturnValue(handleRequest);
	mockCreateServerEntry.mockReturnValue(serverEntry);

	const loaded: { entry?: unknown } = {};

	jest.isolateModules(() => {
		loaded.entry = (require('#src/server.ts') as { default: unknown }).default;
	});

	const streamHandler = mockCreateStartHandler.mock.calls[0]?.[0];
	const served = mockCreateServerEntry.mock.calls[0]?.[0]?.fetch;

	return { entry: loaded.entry, handleRequest, served, serverEntry, streamHandler };
};

describe('server entry', () => {
	test("renders every request with Start's default streaming handler", () => {
		const { streamHandler } = setupServerEntry();

		expect(streamHandler).toBe(mockDefaultStreamHandler);
	});

	test('serves the handler built from it as the entry point the host calls', () => {
		const { handleRequest, served } = setupServerEntry();

		expect(served).toBe(handleRequest);
	});

	test('exports that entry as the module default, which is what the built server starts', () => {
		const { entry, serverEntry } = setupServerEntry();

		expect(entry).toBe(serverEntry);
	});
});
