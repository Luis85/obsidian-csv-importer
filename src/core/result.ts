import type { ImportResult } from "../types";

/** Row outcome reasons. Values are user-facing English text and are persisted in reports only. */
export const ROW_REASON = {
	alreadyExists: "already exists",
	duplicateKey: "duplicate key",
	fileNameTaken: "file name taken by another record",
	notOwned: "not created by this import",
	wouldCreate: "would create",
} as const;

/** A fresh, empty import result. */
export function emptyResult(dryRun = false): ImportResult {
	return {
		created: 0,
		updated: 0,
		unchanged: 0,
		skipped: 0,
		failed: 0,
		cancelled: false,
		dryRun,
		rows: [],
		errors: [],
		warnings: [],
	};
}
