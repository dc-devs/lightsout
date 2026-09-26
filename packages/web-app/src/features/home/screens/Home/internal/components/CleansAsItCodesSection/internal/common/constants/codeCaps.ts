/**
 * The two limits the section animates, as the default Standards Pack ships
 * them: files per folder (`folder-size`) and lines per ordinary source file
 * (`file-size` — `.tsx` files get a looser cap, but a plain `.ts` file is the
 * case most readers will meet).
 *
 * Typed here rather than read from the pack, which is a third of a megabyte
 * this page has no other use for. The section's suite holds both to the pack's
 * own values, so tuning either fails a test until this file follows.
 */
export const codeCaps = { folderFiles: 20, fileLines: 250 } as const;
