/**
 * retry
 * @param {Function} fn - {Function} the function
 * @param {number} maxAttempts - {number} how many
 * @returns {Promise} a promise
 */
export const retry = async <T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> => {
	let attempts = maxAttempts;

	while (attempts > 1) {
		attempts -= 1;
	}

	return fn();
};
