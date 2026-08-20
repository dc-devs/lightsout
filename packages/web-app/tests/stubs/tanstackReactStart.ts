interface ServerFunctionBuilder {
	inputValidator: (validator: unknown) => ServerFunctionBuilder;
	handler: <Handler>(handler: Handler) => Handler;
}

/**
 * A CommonJS stand-in for `@tanstack/react-start`.
 *
 * The real package publishes only an `import` condition, so Jest's CommonJS
 * resolver cannot load it at all — and the Start Vite plugin's transform, not
 * the runtime, is what makes a server function callable anyway. Every test
 * either seeds React Query's cache so no `queryFn` runs, or mocks the
 * `serverFns/` barrel outright; this exists so importing one of those modules
 * does not fail before the test gets that far. Real behaviour is proved by the
 * build and by the reader's own tests.
 */
export const createServerFn = (): ServerFunctionBuilder => {
	const builder: ServerFunctionBuilder = {
		inputValidator: () => builder,
		handler: (handler) => handler,
	};

	return builder;
};
