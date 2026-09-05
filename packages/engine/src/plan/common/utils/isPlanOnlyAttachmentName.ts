import { brainstormNotesFileName } from '#src/common/constants/brainstormNotesFileName.ts';
import { isDurablePlanAttachmentName } from '#src/plan/common/utils/isDurablePlanAttachmentName.ts';

/**
 * Whether an attachment title is evidence that a *plan* generation was
 * published to this ticket.
 *
 * `brainstorm-notes.md` is not: `brainstorm publish` sends it too, so a ticket
 * carrying it and nothing else is a ticket with no plan rather than a
 * half-published one. Selecting which attachments a plan generation may carry
 * is a different question, and stays `isDurablePlanAttachmentName`.
 */
export const isPlanOnlyAttachmentName = ({ name }: { name: string }): boolean => name !== brainstormNotesFileName && isDurablePlanAttachmentName({ name });
