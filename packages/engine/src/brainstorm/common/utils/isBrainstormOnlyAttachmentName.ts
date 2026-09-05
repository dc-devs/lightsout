import { brainstormAttachmentFileNames } from '#src/brainstorm/common/constants/brainstormAttachmentFileNames.ts';
import { brainstormNotesFileName } from '#src/common/constants/brainstormNotesFileName.ts';

/**
 * Whether an attachment title is evidence that a *brainstorm* generation was
 * published to this ticket.
 *
 * `brainstorm-notes.md` is not: a published plan carries it too, so asking with
 * it would find a brainstorm on every plan-carrying ticket, then refuse for the
 * missing `brainstorm-attachments.json`. Only `brainstorm-decisions.json` is
 * sent by `brainstorm publish` alone.
 */
export const isBrainstormOnlyAttachmentName = ({ name }: { name: string }): boolean =>
	name !== brainstormNotesFileName && brainstormAttachmentFileNames.includes(name);
