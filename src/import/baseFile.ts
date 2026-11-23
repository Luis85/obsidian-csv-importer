function q(s: string): string {
	return JSON.stringify(s);
}

/**
 * Content of an Obsidian Bases `.base` file showing all notes in `folder` (recursive) as a table
 * with `file.name` followed by the given properties, in order. View name = `viewName`.
 * Properties are referenced by plain name (as the Obsidian Importer does).
 */
export function buildBaseFile(folder: string, properties: string[], viewName: string): string {
	const f = folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	const filter = f === "" ? null : `file.inFolder(${JSON.stringify(f)})`;
	const order = ["file.name", ...properties.filter((p) => p.trim() !== "")];
	const lines: string[] = [];
	if (filter) {
		lines.push("filters:", "  and:", `    - ${q(filter)}`);
	}
	lines.push("views:", "  - type: table", `    name: ${q(viewName)}`, "    order:");
	for (const p of order) lines.push(`      - ${q(p)}`);
	return lines.join("\n") + "\n";
}
