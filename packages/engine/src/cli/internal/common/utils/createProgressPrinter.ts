export const createProgressPrinter = (): ((message: string) => void) => {
	const startedAt = Date.now();

	return (message: string) => {
		const seconds = Math.round((Date.now() - startedAt) / 1000);

		console.log(`[+${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}] ${message}`);
	};
};
