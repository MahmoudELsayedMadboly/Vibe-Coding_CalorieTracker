#!/usr/bin/env node
// Keeps the translations in sync. Run with `npm run i18n:check`.
//
// Fails (exit code 1) on:
//   - keys missing from either language, or plural forms missing for a
//     language (Arabic needs zero/one/two/few/many/other)
//   - empty values, or {{placeholders}} that differ between languages
//   - Arabic values still identical to the English text
//   - t("key") calls whose key isn't defined, and defined keys nobody uses
//   - English text written directly in the code that isn't in the
//     baseline (scripts/i18n-baseline.json)
//
// The baseline lists the English text still in the code for screens whose
// phase hasn't been translated yet. It should only ever shrink: after
// translating a screen, run `npm run i18n:check -- --update-baseline` and
// commit the smaller file.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = join(ROOT, "src/locales");
const SRC_DIR = join(ROOT, "src");
const BASELINE_PATH = join(ROOT, "scripts/i18n-baseline.json");
const LANGS = ["en", "ar"];
const REFERENCE = "en";

// Values that are meant to be the same in every language.
const SAME_IN_ALL_LANGUAGES = new Set(["language.en", "language.ar"]);

// JSX props whose string value is shown to the user.
const TEXT_PROPS = new Set(["placeholder", "title", "alt", "aria-label", "label", "emptyText", "noMatchText", "emptyLabel", "headerLabel"]);
// Object properties whose string value is shown to the user ({ label: "..." }).
const TEXT_OBJECT_KEYS = new Set(["label", "title", "placeholder"]);
// setFooError("...") / setFooNotice("...") and browser dialogs.
const MESSAGE_SETTER = /^set[A-Z]\w*(Error|Notice|Message)$/;
const DIALOGS = new Set(["confirm", "alert", "prompt"]);

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const ENGLISH_WORD = /[A-Za-z]{2,}/;

const updateBaseline = process.argv.includes("--update-baseline");
// Prints every English string still in the code with its line number.
const listLeftovers = process.argv.includes("--list");
const errors = [];
const warnings = [];

// ---------- translation files ----------

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function placeholders(text) {
  return new Set([...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]));
}

const dicts = {};
for (const lang of LANGS) {
  dicts[lang] = flatten(JSON.parse(readFileSync(join(LOCALES_DIR, `${lang}.json`), "utf8")));
}

// Functions that pass a key through to t() (their callers are checked).
const KEY_FORWARDING_FUNCTIONS = new Set(["errorText", "errorWithReason", "mealLabel", "courseLabel", "bmiCategoryLabel"]);

// Logical keys: plural forms collapse to their base key.
function logicalKeys(dict) {
  const map = new Map();
  for (const key of Object.keys(dict)) {
    const base = key.replace(PLURAL_SUFFIX, "");
    if (!map.has(base)) map.set(base, []);
    if (base !== key) map.get(base).push(key);
  }
  return map;
}

const logical = Object.fromEntries(LANGS.map((lang) => [lang, logicalKeys(dicts[lang])]));

for (const lang of LANGS) {
  for (const other of LANGS) {
    if (lang === other) continue;
    for (const key of logical[lang].keys()) {
      if (!logical[other].has(key)) errors.push(`${other}.json is missing "${key}" (defined in ${lang}.json)`);
    }
  }

  const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
  for (const [base, forms] of logical[lang]) {
    if (forms.length === 0) continue;
    for (const cat of categories) {
      if (!(`${base}_${cat}` in dicts[lang])) errors.push(`${lang}.json: "${base}" is missing its "${cat}" plural form`);
    }
  }

  for (const [key, value] of Object.entries(dicts[lang])) {
    if (typeof value !== "string" || value.trim() === "") errors.push(`${lang}.json: "${key}" is empty`);
  }
}

// Placeholders must match per logical key (a plural form may leave out
// {{count}}, e.g. Arabic "تذكير واحد").
for (const [base] of logical[REFERENCE]) {
  const varsOf = (lang) => {
    const keys = logical[lang].get(base);
    if (!keys) return null;
    const all = keys.length ? keys : [base];
    const set = new Set();
    for (const k of all) for (const v of placeholders(dicts[lang][k])) set.add(v);
    set.delete("count");
    return [...set].sort().join(",");
  };
  const ref = varsOf(REFERENCE);
  for (const lang of LANGS) {
    if (lang === REFERENCE) continue;
    const got = varsOf(lang);
    if (got !== null && got !== ref) errors.push(`${lang}.json: "${base}" uses placeholders {${got}} but ${REFERENCE}.json uses {${ref}}`);
  }
}

for (const lang of LANGS) {
  if (lang === REFERENCE) continue;
  for (const [key, value] of Object.entries(dicts[lang])) {
    if (SAME_IN_ALL_LANGUAGES.has(key)) continue;
    if (value === dicts[REFERENCE][key] && ENGLISH_WORD.test(value.replace(/\{\{\s*\w+\s*\}\}/g, ""))) {
      errors.push(`${lang}.json: "${key}" is still the English text`);
    }
  }
}

// ---------- source code ----------

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const definedKeys = new Set(logical[REFERENCE].keys());
const usedKeys = new Set();
const leftovers = {}; // file -> { text -> count }
const leftoverLines = []; // "file:line  text", for --list

function loc(file, node) {
  return `${relative(ROOT, file)}:${node.loc.start.line}`;
}

// The literal strings an expression can render as-is. Doesn't look inside
// function calls (t(...), formatters) or anything that isn't plain text.
function renderedStrings(node) {
  if (!node) return [];
  switch (node.type) {
    case "StringLiteral":
      return [node.value];
    case "TemplateLiteral":
      return [node.quasis.map((q) => q.value.cooked).join("{…}")];
    case "ConditionalExpression":
      return [...renderedStrings(node.consequent), ...renderedStrings(node.alternate)];
    case "LogicalExpression":
      return node.operator === "&&" ? renderedStrings(node.right) : [...renderedStrings(node.left), ...renderedStrings(node.right)];
    case "BinaryExpression":
      return node.operator === "+" ? [...renderedStrings(node.left), ...renderedStrings(node.right)] : [];
    case "ParenthesizedExpression":
      return renderedStrings(node.expression);
    default:
      return [];
  }
}

function addLeftover(file, text, node) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!ENGLISH_WORD.test(normalized)) return;
  const rel = relative(ROOT, file);
  leftoverLines.push(`${rel}:${node.loc.start.line}  ${normalized}`);
  leftovers[rel] = leftovers[rel] || {};
  leftovers[rel][normalized] = (leftovers[rel][normalized] || 0) + 1;
}

function calleeName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") return callee.property.name;
  return null;
}

function checkKeyArg(file, arg, fnName, enclosingFn) {
  if (!arg) return;
  if (arg.type === "StringLiteral") {
    usedKeys.add(arg.value);
    if (!definedKeys.has(arg.value)) errors.push(`${loc(file, arg)}: ${fnName}("${arg.value}") isn't defined in ${REFERENCE}.json`);
  } else if (!KEY_FORWARDING_FUNCTIONS.has(enclosingFn)) {
    warnings.push(`${loc(file, arg)}: ${fnName}() with a computed key can't be checked`);
  }
}

function walk(file, node, parent, enclosingFn) {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "FunctionDeclaration" && node.id) enclosingFn = node.id.name;

  switch (node.type) {
    case "StringLiteral":
      // Keys can also be referenced from lookup tables (e.g. error codes).
      if (definedKeys.has(node.value)) usedKeys.add(node.value);
      break;
    case "CallExpression": {
      const name = calleeName(node.callee);
      if (node.callee.type === "Identifier" && name === "t") checkKeyArg(file, node.arguments[0], "t", enclosingFn);
      else if (node.callee.type === "Identifier" && name === "errorText") checkKeyArg(file, node.arguments[1], "errorText", enclosingFn);
      else if (node.callee.type === "Identifier" && name === "errorWithReason") {
        checkKeyArg(file, node.arguments[1], "errorWithReason", enclosingFn);
        checkKeyArg(file, node.arguments[2], "errorWithReason", enclosingFn);
      }
      else if (name && (MESSAGE_SETTER.test(name) || DIALOGS.has(name))) {
        for (const s of renderedStrings(node.arguments[0])) addLeftover(file, s, node);
      }
      break;
    }
    case "JSXText":
      addLeftover(file, node.value, node);
      break;
    case "JSXExpressionContainer":
      if (parent && (parent.type === "JSXElement" || parent.type === "JSXFragment")) {
        for (const s of renderedStrings(node.expression)) addLeftover(file, s, node);
      }
      break;
    case "JSXAttribute": {
      const attr = node.name.type === "JSXIdentifier" ? node.name.name : null;
      if (attr && TEXT_PROPS.has(attr) && node.value) {
        const expr = node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value;
        for (const s of renderedStrings(expr)) addLeftover(file, s, node);
      }
      break;
    }
    case "ObjectProperty": {
      const key = node.key.type === "Identifier" ? node.key.name : node.key.type === "StringLiteral" ? node.key.value : null;
      if (key && TEXT_OBJECT_KEYS.has(key)) {
        for (const s of renderedStrings(node.value)) addLeftover(file, s, node);
      }
      break;
    }
    default:
      break;
  }

  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "leadingComments" || key === "trailingComments") continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => walk(file, c, node, enclosingFn));
    else if (child && typeof child.type === "string") walk(file, child, node, enclosingFn);
  }
}

for (const file of sourceFiles(SRC_DIR)) {
  const ast = parse(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["jsx"], errorRecovery: false });
  walk(file, ast.program, null);
}

for (const key of definedKeys) {
  if (!usedKeys.has(key)) errors.push(`"${key}" is defined but never used`);
}

// ---------- English text still in the code ----------

const sortObject = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, typeof o[k] === "object" ? sortObject(o[k]) : o[k]]));
let remaining = 0;
for (const counts of Object.values(leftovers)) for (const n of Object.values(counts)) remaining += n;

if (updateBaseline) {
  writeFileSync(BASELINE_PATH, JSON.stringify(sortObject(leftovers), null, 2) + "\n");
  console.log(`Baseline updated: ${remaining} English strings left in the code.`);
} else {
  let baseline = {};
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (_) {
    warnings.push("No baseline yet; run with --update-baseline");
  }
  for (const [file, counts] of Object.entries(leftovers)) {
    for (const [text, n] of Object.entries(counts)) {
      const allowed = (baseline[file] && baseline[file][text]) || 0;
      if (n > allowed) errors.push(`${file}: English text not translated: "${text}"${n - allowed > 1 ? ` (${n - allowed}x)` : ""}`);
    }
  }
  let stale = 0;
  for (const [file, counts] of Object.entries(baseline)) {
    for (const [text, n] of Object.entries(counts)) {
      const now = (leftovers[file] && leftovers[file][text]) || 0;
      if (now < n) stale += n - now;
    }
  }
  if (stale > 0) warnings.push(`${stale} baseline entries are already translated; run with --update-baseline to shrink it`);
}

if (listLeftovers) leftoverLines.forEach((l) => console.log(l));

for (const w of warnings) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
console.log(
  `${definedKeys.size} keys in ${LANGS.length} languages, ${usedKeys.size} used. ` +
    `${remaining} English strings still in the code (phases not translated yet).`
);
if (errors.length > 0) {
  console.error(`i18n check failed with ${errors.length} error${errors.length === 1 ? "" : "s"}.`);
  process.exit(1);
}
console.log("i18n check passed.");
