import { brainstormNotesFileName } from '#src/common/constants/brainstormNotesFileName.ts';

/**
 * The two files a published brainstorm carries, in the order they are attached.
 *
 * Deliberately not the plan's `durablePlanFileNames`: `brainstorm-decisions.json`
 * is absent from that list on purpose, because `plan draft` merges its rows into
 * the plan's Decision Log and attaching it there would put them on the ticket
 * twice.
 */
export const brainstormAttachmentFileNames: string[] = [brainstormNotesFileName, 'brainstorm-decisions.json'];
