export const SyncEventKind = {
	FileAdded: 'file-added',
	RecordParsed: 'record-parsed',
} as const;

export type SyncEventKind = (typeof SyncEventKind)[keyof typeof SyncEventKind];
