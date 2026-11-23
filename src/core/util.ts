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

/** Random RFC 4122 version 4 UUID (uses crypto.randomUUID when available, else crypto.getRandomValues). */
export function uuidV4(): string {
	const c = window.crypto;
	if (c && typeof c.randomUUID === "function") return c.randomUUID();
	const b = new Uint8Array(16);
	c.getRandomValues(b);
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
