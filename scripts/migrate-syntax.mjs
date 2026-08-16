#!/usr/bin/env node
// Migrates Turn DSL sources across the v2 syntax boundary (tmp/NEW_SYNTAX.md).
//
// Usage:
//   node scripts/migrate-syntax.mjs <path>...      rewrite the given files
//   node scripts/migrate-syntax.mjs --check <path>...  report without writing
//
// Paths may be .tu files or any text file that embeds Turn DSL (the Go test
// suites carry DSL inside string literals, and the transformations here are
// textual, so both work).
//
// Transformations, in the order the phases land:
//   2.1  #if( / #case( / #pipe(  ->  if( / case( / pipe(
//        `#it` is deliberately untouched: it keeps its prefix because it is a
//        placeholder rather than a reference. `#` comments are untouched too.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Reserved words that cannot appear as a bare reference. An action or scene
// whose id collides with one of these keeps its quotes — `action = "publish"`
// stays quoted because `publish` lexes as a keyword, not an identifier.
const RESERVED = new Set([
  "state",
  "state_file",
  "scene",
  "action",
  "compute",
  "prepare",
  "merge",
  "publish",
  "next",
  "prog",
  "entry_actions",
  "next_policy",
  "from_state",
  "from_action",
  "from_hook",
  "from_literal",
  "to_state",
  "hook",
  "view",
  "flow",
  "enforce",
  "text",
  "route",
  "match",
  "entry",
  "type",
  "overview",
  "true",
  "false",
  "if",
  "case",
  "pipe",
]);

/** Strips quotes from a reference unless the name is reserved. */
function bareRef(quoted) {
  const name = quoted.replace(/^"(.*)"$/, "$1");
  return RESERVED.has(name) ? `"${name}"` : name;
}

/** @type {{name: string, apply: (src: string) => string}[]} */
const transforms = [
  {
    name: "2.1 drop # on forms",
    apply: (src) =>
      rewriteCodeLines(src, (code) => replaceOutsideStrings(code, /#(if|case|pipe)\(/g, "$1(")),
  },
  {
    name: "2.2 overview block",
    apply: rewriteOverview,
  },
  {
    name: "3 inline IO",
    // Removing prepare/merge blocks leaves runs of blank lines behind; collapse
    // them so the migrated file reads the way it would have been written.
    apply: (src) => rewriteInlineIO(src).replace(/\n[ \t]*\n([ \t]*\n)+/g, "\n\n"),
  },
  {
    // Any sigil the inline pass could not pair with a prepare/merge entry — a
    // compact single-line prog, or a fixture that deliberately omits the entry.
    // Prefix sigils are retired outright: a binding's direction now comes from
    // its inline clause or from the block entry naming it, so dropping the
    // prefix is the whole migration for these.
    name: "3 strip leftover prefix sigils",
    // [ \t]* rather than \s*: a sigil must not be paired with an identifier on
    // a following line, or a trailing `<~` in a comment swallows the next line.
    apply: (src) =>
      rewriteCodeLines(src, (code) =>
        replaceOutsideStrings(code, /(^|[ \t{])(?:<~>|<~|~>)[ \t]*([A-Za-z_]\w*[ \t]*:)/g, "$1$2"),
      ),
  },
  {
    name: "4 parenthesize computed egress",
    apply: wrapComputedEgress,
  },
  {
    name: "5 contextual prog result",
    apply: rewriteResultMarkers,
  },
  {
    // References become bare identifiers; quoted strings stay for real strings.
    name: "2.3 bare references",
    apply: (src) =>
      rewriteCodeLines(src, (code) =>
        code
          .replace(/\bentry_actions(\s*)=(\s*)\[([^\]]*)\]/g, (m, s1, s2, items) => {
            const bare = items
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .map(bareRef);
            return `entry_actions${s1}=${s2}[${bare.join(", ")}]`;
          })
          .replace(
            /\bentry(\s+)"([A-Za-z_][A-Za-z0-9_]*)"/g,
            (m, _s, name) => `entry = ${bareRef(`"${name}"`)}`,
          )
          .replace(
            /\baction(\s*)=(\s*)"([A-Za-z_][A-Za-z0-9_]*)"/g,
            (m, s1, s2, name) => `action${s1}=${s2}${bareRef(`"${name}"`)}`,
          ),
      ),
  },
  {
    // The conditional transition sugar now reads in evaluation order, so the
    // guard moves ahead of the target it selects. Both operands are plain
    // identifiers in the old form, which is what makes the swap safe to do
    // textually. `next <action>` on its own is unchanged.
    name: "1.4 transition arrow",
    apply: (src) =>
      rewriteCodeLines(src, (code) =>
        replaceOutsideStrings(
          code,
          /\bnext(\s+)([A-Za-z_]\w*)\s+if\s+([A-Za-z_]\w*)\b/g,
          (_match, gap, action, cond) => `next${gap}${cond} -> ${action}`,
        ),
      ),
  },
];

// Replaces the retired context-specific prefix markers with the contextual
// result operator. The RHS separator becomes :=; inline and structural inputs
// place := immediately after the declared type.
function rewriteResultMarkers(src) {
  return rewriteCodeLines(src, (code) =>
    replaceOutsideStrings(
      code,
      /(^|[ \t{])(?:\|\^\||\|\?\|)[ \t]+([A-Za-z_]\w*[ \t]*:[ \t]*(?:arr<[^>\n]+>|[A-Za-z_]\w*))[ \t]*(=|<~)?/g,
      (_match, lead, decl, rhs) => `${lead}${decl} :=${rhs === "<~" ? " <~" : ""}`,
    ),
  );
}

// Wraps the complete RHS of every computed inline egress. The declaration may
// be single-line or may contain a multiline call/construction; delimiter depth
// identifies the line where that expression ends and the egress arrow begins.
function wrapComputedEgress(src) {
  const lines = src.split("\n");
  const declaration = /^(\s*(?:\|\^\|\s*|\|\?\|\s*)?[A-Za-z_]\w*\s*:\s*[^=\s]+\s*=\s*)(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const comment = commentStart(lines[i]);
    const code = comment < 0 ? lines[i] : lines[i].slice(0, comment);
    const match = declaration.exec(code);
    if (!match) continue;
    const [, prefix, firstRhs] = match;
    if (firstRhs.trimStart().startsWith("(")) continue; // already migrated

    let depth = delimiterDelta(firstRhs);
    for (let j = i; j < lines.length; j++) {
      const currentComment = commentStart(lines[j]);
      const currentCode = currentComment < 0 ? lines[j] : lines[j].slice(0, currentComment);
      if (j > i) depth += delimiterDelta(currentCode);
      if (depth > 0) continue;

      const arrow = currentCode.indexOf("~>");
      if (arrow < 0) break;
      const beforeArrow = currentCode.slice(0, arrow).trimEnd();
      const afterArrow = lines[j].slice(arrow);
      if (i === j) {
        const rhsBeforeArrow = currentCode.slice(prefix.length, arrow).trimEnd();
        lines[i] = `${prefix}(${rhsBeforeArrow}) ${afterArrow}`;
      } else {
        lines[i] = `${prefix}(${firstRhs}`;
        lines[j] = `${beforeArrow}) ${afterArrow}`;
      }
      i = j;
      break;
    }
  }
  return lines.join("\n");
}

function delimiterDelta(text) {
  let depth = 0;
  for (const ch of stripStrings(text)) {
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
  }
  return depth;
}

/** Applies a rewrite only before an unquoted DSL comment on each line. */
function rewriteCodeLines(src, rewrite) {
  return src
    .split("\n")
    .map((line) => {
      const comment = commentStart(line);
      return comment < 0 ? rewrite(line) : rewrite(line.slice(0, comment)) + line.slice(comment);
    })
    .join("\n");
}

function commentStart(line) {
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "#" && !/^(?:#(?:if|case|pipe)\(|#it\b)/.test(line.slice(i))) return i;
    else if (ch === "/" && line[i + 1] === "/") return i;
  }
  return -1;
}

/** Applies a replacement outside double-quoted DSL string literals. */
function replaceOutsideStrings(code, pattern, replacement) {
  let out = "";
  let start = 0;
  let i = 0;
  while (i < code.length) {
    if (code[i] !== '"') {
      i++;
      continue;
    }
    out += code.slice(start, i).replace(pattern, replacement);
    const quoteStart = i++;
    let escaped = false;
    while (i < code.length) {
      const ch = code[i++];
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') break;
    }
    out += code.slice(quoteStart, i);
    start = i;
  }
  return out + code.slice(start).replace(pattern, replacement);
}

// rewriteOverview converts
//
//   view "overview" {
//     flow = <<-EOT
//       a
//         |=> b
//     EOT
//     enforce = "strict"
//   }
//
// into `overview strict { a |=> b }`.
//
// The heredoc's leading-`|=>` continuation lines are expanded against the
// current source node, because the block form has no notion of "the previous
// line". Chain lines (`a |=> b |=> c`) carry over unchanged — the parser wires
// them sequentially exactly as the flow text did.
function rewriteOverview(src) {
  const viewRe =
    /([ \t]*)view\s+"overview"\s*\{\s*flow\s*=\s*<<-?(\w+)\r?\n([\s\S]*?)^\s*\2\s*$([\s\S]*?)^\1\}[ \t]*$/gm;

  return src.replace(viewRe, (match, indent, _tag, body, tail) => {
    const enforceMatch = /enforce\s*=\s*"([^"]*)"/.exec(tail);
    const mode = enforceMatch ? enforceMatch[1] : "";

    /** @type {string[]} */
    const statements = [];
    let current = null;
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (line === "") continue;
      if (line.startsWith("|=>")) {
        const target = line.slice(3).trim();
        // An edge line sources from the node most recently named.
        if (current !== null) statements.push(`${current} |=> ${target}`);
        continue;
      }
      if (line.includes("|=>")) {
        const parts = line.split("|=>").map((s) => s.trim());
        statements.push(parts.join(" |=> "));
        current = parts[parts.length - 1];
        continue;
      }
      // Bare node line: remember it as the source for following edge lines, and
      // keep it only if nothing ever points out of it.
      current = line;
      statements.push(line);
    }

    // A bare node line that later gained edges is redundant: the edge statements
    // already declare it as a source.
    const sources = new Set(
      statements.filter((s) => s.includes("|=>")).map((s) => s.split("|=>")[0].trim()),
    );
    const kept = statements.filter((s) => s.includes("|=>") || !sources.has(s));

    const inner = kept.map((s) => `${indent}  ${s}`).join("\n");
    const head = mode ? `overview ${mode} {` : "overview {";
    return `${indent}${head}\n${inner}\n${indent}}`;
  });
}

export function migrate(src, { keepBlocks = false } = {}) {
  let out = src;
  const applied = [];
  for (const t of transforms) {
    // --keep-blocks migrates the syntax but leaves prepare/merge blocks in
    // place, for sources that are about the block form itself. Prefix sigils
    // are still dropped: direction now comes from the block entry.
    if (keepBlocks && t.name === "3 inline IO") continue;
    const next = t.apply(out);
    if (next !== out) applied.push(t.name);
    out = next;
  }
  return { out, applied };
}

function main(argv) {
  const check = argv.includes("--check");
  const keepBlocks = argv.includes("--keep-blocks");
  const paths = argv.filter((a) => !a.startsWith("--"));
  if (paths.length === 0) {
    console.error("usage: migrate-syntax.mjs [--check] [--keep-blocks] <path>...");
    return 2;
  }

  let changed = 0;
  for (const path of paths) {
    const src = readFileSync(path, "utf8");
    const { out, applied } = migrate(src, { keepBlocks });
    if (out === src) continue;
    changed++;
    console.log(`${check ? "would rewrite" : "rewrote"} ${path} (${applied.join(", ")})`);
    if (!check) writeFileSync(path, out);
  }
  console.log(`${changed} file(s) ${check ? "would change" : "changed"} of ${paths.length}`);
  return check && changed > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — inline IO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rewrites prefix sigils plus prepare/merge blocks into inline IO.
 *
 *   compute { prog "p" {           compute { prog "p" {
 *     ~>a:bool                       a:bool <~ @ns.f
 *     <~b:str = "v"          =>      b:str = ("v") ~> @ns.h
 *     <~>c:number                    c:number <~ @ns.g ~> @ns.i
 *   } }                            } }
 *   prepare { a { from_state = ns.f } ... }
 *   merge   { b { to_state = ns.h } ... }
 *
 * The arrows invert: `~>` was ingress with STATE implicitly on the left, and is
 * egress here because the destination is now written on the right.
 *
 * Works block-by-block over an `action "..." { ... }` region so that a next
 * rule's prepare is matched against the next rule's own prog.
 */
function rewriteInlineIO(src) {
  const lines = src.split("\n");
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const actionMatch = /^(\s*)action\s+("[^"]*"|\S+)\s*\{\s*$/.exec(lines[i]);
    if (!actionMatch) {
      out.push(lines[i]);
      continue;
    }
    const end = matchingBrace(lines, i);
    if (end < 0) {
      out.push(lines[i]);
      continue;
    }
    out.push(...rewriteActionRegion(lines.slice(i, end + 1)));
    i = end;
  }
  return out.join("\n");
}

/** Returns the index of the line closing the block opened on line `start`. */
function matchingBrace(lines, start) {
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    for (const ch of stripStrings(lines[i])) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

/** Blanks out string literals so braces inside them do not affect depth. */
function stripStrings(line) {
  return line.replace(/"[^"]*"/g, '""').replace(/#.*$/, "");
}

/**
 * Rewrites one action region: hoists its prepare/merge entries onto the binding
 * lines they describe, then drops the emptied blocks. Nested next regions are
 * handled recursively so each prog matches its own prepare.
 */
function rewriteActionRegion(lines) {
  // Recurse into next blocks first; their prepare belongs to their own prog.
  const spans = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*next\s*\{\s*$/.test(lines[i])) {
      const end = matchingBrace(lines, i);
      if (end > i) {
        spans.push([i, end]);
        i = end;
      }
    }
  }
  let work = lines;
  for (let s = spans.length - 1; s >= 0; s--) {
    const [a, b] = spans[s];
    const inner = hoistRegion(work.slice(a, b + 1));
    work = [...work.slice(0, a), ...inner, ...work.slice(b + 1)];
  }
  // Then the action's own prepare/merge, ignoring anything inside next blocks.
  return hoistRegion(work, true);
}

/**
 * Collects prepare/merge entries in a region, rewrites the matching binding
 * lines, and removes the consumed blocks.
 * When skipNested is set, entries inside nested `next` blocks are left alone.
 */
function hoistRegion(lines, skipNested = false) {
  const nested = skipNested ? nestedNextSpans(lines) : [];
  const inNested = (i) => nested.some(([a, b]) => i >= a && i <= b);

  /** @type {Map<string,string>} */ const inputs = new Map();
  /** @type {Map<string,string>} */ const outputs = new Map();
  /** Blocks that are candidates for removal: [start, end, names]. */
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    if (inNested(i)) continue;
    const head = /^(\s*)(prepare|merge)\s*\{\s*$/.exec(lines[i]);
    if (!head) continue;
    const end = matchingBrace(lines, i);
    if (end < 0) continue;

    const names = [];
    let consumedAll = true;
    for (let j = i + 1; j < end; j++) {
      const e =
        /^\s*([A-Za-z_]\w*)\s*\{\s*(from_state|to_state|from_action|from_literal|from_hook)\s*=\s*([^}]+?)\s*\}\s*$/.exec(
          lines[j],
        );
      if (!e) {
        if (lines[j].trim() !== "") consumedAll = false;
        continue;
      }
      const [, name, key, rawValue] = e;
      // State paths may be written quoted; `@` takes a bare dotted path.
      const value = rawValue.trim();
      const path = value.replace(/^"(.*)"$/, "$1");
      if (key === "from_state") inputs.set(name, `@${path}`);
      else if (key === "to_state") outputs.set(name, `@${path}`);
      else if (key === "from_action") inputs.set(name, `action(${value})`);
      else if (key === "from_hook") inputs.set(name, `hook(${value})`);
      else if (key === "from_literal") inputs.set(name, value);
      else consumedAll = false;
      names.push(name);
    }
    if (consumedAll) blocks.push({ start: i, end, names });
  }

  if (inputs.size === 0 && outputs.size === 0) return lines;

  // First rewrite the binding lines, recording which entries actually landed.
  // A block is removed only when every one of its entries was applied; a compact
  // single-line prog that the rewriter cannot match must keep its block, or the
  // migration would silently drop the binding's source.
  const applied = new Set();
  const rewritten = lines.map((line) => {
    const r = rewriteBindingLine(line, inputs, outputs, applied);
    return r;
  });
  const drop = new Set();
  for (const b of blocks) {
    if (b.names.every((n) => applied.has(n))) {
      for (let j = b.start; j <= b.end; j++) drop.add(j);
    }
  }

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (drop.has(i)) continue;
    const r = rewritten[i];
    if (typeof r === "string") {
      out.push(r);
      continue;
    }
    // The RHS runs past this line (a multi-line if/case/pipe). The egress arrow
    // belongs after the expression ends, not in the middle of it, so copy the
    // continuation lines through and append once the parens balance again.
    out.push(r.head);
    let depth = parenDelta(lines[i]);
    let j = i + 1;
    for (; j < lines.length && depth > 0; j++) {
      depth += parenDelta(lines[j]);
      if (depth <= 0) {
        out.push(`${lines[j]} ${r.tail}`);
        break;
      }
      out.push(lines[j]);
    }
    i = j;
  }
  return out;
}

/** Net change in paren depth contributed by a line, ignoring strings/comments. */
function parenDelta(line) {
  let d = 0;
  for (const ch of stripStrings(line)) {
    if (ch === "(") d++;
    else if (ch === ")") d--;
  }
  return d;
}

/** Spans of `next { ... }` blocks within a region. */
function nestedNextSpans(lines) {
  const spans = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*next\s*\{\s*$/.test(lines[i])) {
      const end = matchingBrace(lines, i);
      if (end > i) {
        spans.push([i, end]);
        i = end;
      }
    }
  }
  return spans;
}

/**
 * Rewrites a single sigil-prefixed binding declaration into inline IO.
 * Records each binding whose mapping was applied in `applied`, so the caller
 * knows which prepare/merge blocks are now redundant.
 */
function rewriteBindingLine(line, inputs, outputs, applied = new Set()) {
  const m =
    /^(\s*)(\|\^\|\s*|\|\?\|\s*)?(~>|<~>|<~)\s*([A-Za-z_]\w*)\s*:\s*([^=\s]+)\s*(=\s*(.*?))?\s*$/.exec(
      line,
    );
  if (!m) return line;
  const [, indent, marker = "", sigil, name, type, , rhs] = m;

  const wantsInput = sigil === "~>" || sigil === "<~>";
  const wantsOutput = sigil === "<~" || sigil === "<~>";
  const src = wantsInput ? inputs.get(name) : undefined;
  const dst = wantsOutput ? outputs.get(name) : undefined;

  // Leave the line alone if the mapping it needs is not in this region; a later
  // pass over the enclosing region will pick it up.
  if (wantsInput && src === undefined) return line;
  if (wantsOutput && dst === undefined) return line;
  applied.add(name);

  let s = `${indent}${marker}${name}:${type}`;
  if (src !== undefined) s += ` <~ ${src}`;
  if (rhs !== undefined && rhs !== "") s += ` = ${rhs}`;

  const tail = dst === undefined ? "" : `~> ${dst}`;
  if (tail !== "" && parenDelta(line) > 0) {
    // Unbalanced parens mean the RHS continues on the following lines; the
    // caller appends `tail` after the expression closes.
    return { head: s, tail };
  }
  return tail === "" ? s : `${s} ${tail}`;
}
