import type { SyncEventKind } from '../constants/SyncEventKind';

export interface FileAddedEvent {
	kind: typeof SyncEventKind.FileAdded;
	path: string;
}

export interface RecordParsedEvent {
	kind: typeof SyncEventKind.RecordParsed;
	recordId: string;
}

export type SyncEvent = FileAddedEvent | RecordParsedEvent;
