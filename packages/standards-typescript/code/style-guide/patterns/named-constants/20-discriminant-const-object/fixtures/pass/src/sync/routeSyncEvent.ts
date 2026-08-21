import { SyncEventKind } from '../common/constants/SyncEventKind';
import type { SyncEvent } from '../common/types/SyncEvent';

// Both ways of narrowing reference the const object, so the family's strings
// live in exactly one file.
export const routeSyncEvent = ({ event }: { event: SyncEvent }): string => {
	if (event.kind === SyncEventKind.FileAdded) {
		return event.path;
	}

	switch (event.kind) {
		case SyncEventKind.RecordParsed: {
			return event.recordId;
		}
		default: {
			return '';
		}
	}
};
