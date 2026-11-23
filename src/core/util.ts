/** Small shared helpers. Pure: no Obsidian imports. */

/** Message of an unknown thrown value. */
export function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** Parent folder of a vault path ("" for the vault root). */
export function parentOf(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? "" : path.slice(0, i);
}

/** `plural(1, "note", "notes")` -> "1 note"; `plural(3, ...)` -> "3 notes". */
export function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}
