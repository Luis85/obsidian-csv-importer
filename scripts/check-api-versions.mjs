// Type-aware check: reports every use of an Obsidian API (method OR property) whose @since is newer than
// manifest.json minAppVersion and that is not guarded. Complements eslint-plugin-obsidianmd's
// no-unsupported-api, which (0.6.0) skips plain properties such as Plugin.settings. Also reports class members that
// override a newer base-class member (for example `override getSettingDefinitions()`).
// Usage: node scripts/check-api-versions.mjs   (exit 1 when unguarded newer APIs are found)
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const min = manifest.minAppVersion.split(".").map(Number);
const newer = (v) => {
	const a = v.split(".").map(Number);
	for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (min[i] ?? 0)) return (a[i] ?? 0) > (min[i] ?? 0);
	return false;
};

const cfgPath = ts.findConfigFile(".", ts.sys.fileExists, "tsconfig.json");
const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, ".");
const isSrc = (f) => path.relative(".", path.resolve(f)).split(path.sep)[0] === "src";
const program = ts.createProgram(parsed.fileNames.filter(isSrc), parsed.options);
const checker = program.getTypeChecker();

function sinceOf(symbol) {
	for (const decl of symbol.getDeclarations() ?? []) {
		if (!decl.getSourceFile().fileName.includes("node_modules/obsidian/")) return null;
		for (const tag of ts.getJSDocTags(decl)) {
			if (tag.tagName.text === "since") {
				const t = typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
				if (t) return t.trim();
			}
		}
	}
	return null;
}

// A use inside `if (requireApiVersion("x"))` / `requireApiVersion("x") ? … : …` / `&&` is guarded.
function guarded(node, version) {
	for (let n = node.parent; n; n = n.parent) {
		const cond = ts.isIfStatement(n) || ts.isConditionalExpression(n) ? n.expression ?? n.condition : ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? n.left : null;
		if (cond && /requireApiVersion\(\s*["'](\d+\.\d+\.\d+)["']\s*\)/.test(cond.getText())) {
			const v = cond.getText().match(/requireApiVersion\(\s*["'](\d+\.\d+\.\d+)["']\s*\)/)[1];
			if (!newer(v) || v.localeCompare(version, undefined, { numeric: true }) >= 0) return true;
		}
		if (ts.isFunctionLike(n) && n.body && /requireApiVersion\(/.test(n.body.getText().slice(0, 200)) && /return/.test(n.body.getText().slice(0, 200))) return true;
	}
	return false;
}

/** The Obsidian base-class members a class member overrides (`override getSettingDefinitions()`, `override settings`). */
function overriddenMembers(member) {
	const cls = member.parent;
	if (!member.name || !ts.isClassLike(cls)) return [];
	const name = member.name.getText();
	const out = [];
	for (const clause of cls.heritageClauses ?? []) {
		for (const t of clause.types) {
			const prop = checker.getTypeAtLocation(t).getProperty(name);
			if (prop) out.push(prop);
		}
	}
	return out;
}

/** Overriding a newer method or property only works on Obsidian versions that call or read it. */
function checkOverride(sf, node) {
	const member = ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isGetAccessor(node);
	if (!member || !ts.isClassLike(node.parent)) return;
	for (const base of overriddenMembers(node)) {
		const since = sinceOf(base);
		if (since && newer(since)) report(sf, node.name, `override ${node.name.getText()}`, since);
	}
}

const problems = [];
const report = (sf, node, text, since) => {
	const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
	problems.push(`${path.relative(".", sf.fileName)}:${line + 1}  ${text}  requires ${since} (minAppVersion ${manifest.minAppVersion})`);
};
for (const sf of program.getSourceFiles()) {
	if (sf.isDeclarationFile || !isSrc(sf.fileName)) continue;
	const visit = (node) => {
		checkOverride(sf, node);
		if (ts.isPropertyAccessExpression(node)) {
			const sym = checker.getSymbolAtLocation(node.name);
			if (sym) {
				const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
				const since = sinceOf(target);
				if (since && newer(since) && !guarded(node, since)) report(sf, node, node.getText(), since);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
}
if (problems.length) {
	console.log(problems.join("\n"));
	console.log(`\n${problems.length} use(s) of Obsidian APIs newer than minAppVersion ${manifest.minAppVersion}.`);
	process.exit(1);
}
console.log(`No unguarded Obsidian APIs newer than ${manifest.minAppVersion}.`);
