import { normalizeRecords } from './normalizeRecords';
import { writeRecords } from './writeRecords';

interface Params {
	records: Array<{ id: string; amount: number }>;
}

// Linear, and every step is a call: the exception the size table grants.
export const startSync = ({ records }: Params): string[] => {
	const normalized = normalizeRecords({ records });

	return writeRecords({ records: normalized });
};
