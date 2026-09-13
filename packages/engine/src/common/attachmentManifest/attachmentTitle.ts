interface Params {
	/** The plan id the title is namespaced under. Absent for a legacy folder, whose titles stay bare. */
	prefix?: string;
	/** The file's own bare name, exactly as the commit marker lists it. */
	name: string;
}

/**
 * The one spelling of a namespaced attachment title: `<plan-id>--<file name>`.
 *
 * A ticket carries every plan's files side by side, so a title has to say which
 * plan it belongs to. The separator is two hyphens because a plan id never
 * holds two consecutive hyphens, which is what lets `scopeAttachments` tell
 * `001-a--plan.md` from a longer id's `001-a-b--plan.md`.
 */
export const attachmentTitle = ({ prefix, name }: Params): string => (prefix === undefined ? name : `${prefix}--${name}`);
