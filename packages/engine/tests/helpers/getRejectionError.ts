interface Params {
	promise: Promise<unknown>;
}

/**
 * The Error a promise rejected with, so one rejection can be asserted about more
 * than once — `expect(...).rejects` matchers each re-await, which re-invokes the
 * call under test. Node's `assert.rejects` accepted a predicate for this; Jest
 * has no equivalent, so the rejection is captured once here instead.
 *
 * @param promise - the call under test, already invoked
 * @throws {Error} When the promise resolves, or rejects with a non-Error
 */
export const getRejectionError = async ({ promise }: Params): Promise<Error> => {
	let caught: unknown;
	let rejected = false;

	try {
		await promise;
	} catch (error) {
		caught = error;
		rejected = true;
	}

	if (!rejected) {
		throw new Error('expected a rejection, but the promise resolved');
	}

	// Deliberately NOT `caught instanceof Error`. Jest runs each test file in its
	// own realm with its own `Error` global, while errors thrown from Node's
	// built-ins (fs, child_process) are constructed in the outer realm — so
	// `instanceof Error` is FALSE for a genuine `ENOTDIR`/`EACCES` rejection.
	// `Object.prototype.toString` reads the internal tag instead, which is
	// realm-independent.
	if (Object.prototype.toString.call(caught) !== '[object Error]') {
		throw new Error(`expected a rejection with an Error, got: ${String(caught)}`);
	}

	return caught as Error;
};
