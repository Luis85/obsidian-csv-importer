/** Row of buttons that insert `{{placeholder}}` tokens into a text field. */
export function renderChipRow(box: HTMLElement, label: string, tokens: string[], onPick: (token: string) => void): void {
	box.empty();
	box.createSpan({ cls: "csv-importer-chips-label", text: label });
	for (const token of tokens) {
		const chip = box.createEl("button", { cls: "csv-importer-chip", text: token });
		chip.type = "button";
		chip.addEventListener("click", (ev) => {
			ev.preventDefault();
			onPick(token);
		});
	}
}

/** Placeholder tokens offered for a file: row, file and one per column header. */
export function placeholderTokens(headers: string[] | undefined): string[] {
	return ["{{row}}", "{{file}}", ...(headers ? headers.map((h) => `{{${h}}}`) : [])];
}

/** Insert `token` at the cursor of `target`, refocus it, and return the new value. */
export function insertAtCursor(target: HTMLInputElement | HTMLTextAreaElement, token: string): string {
	const start = target.selectionStart ?? target.value.length;
	const end = target.selectionEnd ?? target.value.length;
	target.value = target.value.slice(0, start) + token + target.value.slice(end);
	const pos = start + token.length;
	target.focus();
	target.setSelectionRange(pos, pos);
	return target.value;
}
