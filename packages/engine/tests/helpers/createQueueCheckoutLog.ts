/** Every git mutation of the main checkout, and how many of them ever ran at once. */
export const createQueueCheckoutLog = ({ onActivity }: { onActivity: () => void }) => {
	const mutations: string[] = [];
	let inFlight = 0;
	let peak = 0;

	const mutate = async ({ label }: { label: string }) => {
		mutations.push(label);
		inFlight += 1;
		peak = Math.max(peak, inFlight);
		onActivity();

		for (let turn = 0; turn < 4; turn += 1) {
			await new Promise((resolve) => setImmediate(resolve));
		}

		inFlight -= 1;
	};

	return { mutate, mutations: () => [...mutations], peak: () => peak };
};
