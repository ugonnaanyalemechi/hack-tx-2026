/**
 * A small hand-written YAML serializer for the agent file shown in the build
 * form. Covers what an agent spec needs (maps, lists, scalars, null, block
 * scalars for multi-line text) and nothing more; no YAML library is added.
 */

export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

const PLAIN_SAFE = /^[A-Za-z0-9_./][A-Za-z0-9_./ -]*$/;
const RESERVED = /^(true|false|null|yes|no|on|off|~|[-+]?\d[\d_.eE+-]*)$/i;

function scalar(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === "") return '""';
  if (PLAIN_SAFE.test(value) && !RESERVED.test(value) && !value.endsWith(" ")) return value;
  return JSON.stringify(value);
}

function isMap(value: YamlValue): value is { [key: string]: YamlValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function block(lines: string[], indent: string): string[] {
  return lines.map((l) => (l === "" ? "" : indent + l));
}

function entries(
  map: { [key: string]: YamlValue },
  depth: number,
  comments: Record<string, string>
): string[] {
  const pad = "  ".repeat(depth);
  const out: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    const note = comments[key] ? `   # ${comments[key]}` : "";
    if (typeof value === "string" && value.includes("\n")) {
      // Block scalar keeps line breaks readable.
      const keep = value.endsWith("\n") ? "" : "-";
      out.push(`${pad}${key}: |${keep}`);
      out.push(...block(value.replace(/\n$/, "").split("\n"), `${pad}  `));
    } else if (typeof value === "string" && value.length > 60 && !/^\s|\s$|\s\s/.test(value)) {
      // Long one-line text folds at word breaks (`>-`), same text when read back.
      out.push(`${pad}${key}: >-`);
      let line = "";
      for (const word of value.split(" ")) {
        if (line && line.length + 1 + word.length > 60) {
          out.push(`${pad}  ${line}`);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      out.push(`${pad}  ${line}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        out.push(`${pad}${key}: []`);
      } else {
        out.push(`${pad}${key}:`);
        for (const item of value) {
          if (isMap(item) || Array.isArray(item)) {
            out.push(`${pad}  - ${JSON.stringify(item)}`);
          } else {
            const itemComment = comments[`${key}.${String(item)}`];
            out.push(`${pad}  - ${scalar(item)}${itemComment ? `   # ${itemComment}` : ""}`);
          }
        }
      }
    } else if (isMap(value)) {
      out.push(`${pad}${key}:${note}`);
      out.push(...entries(value, depth + 1, {}));
    } else {
      out.push(`${pad}${key}: ${scalar(value)}${note}`);
    }
  }
  return out;
}

/**
 * Serialize a map to YAML. `comments` adds trailing `# note`s: key for a
 * scalar or map key, `list.item` for a list entry.
 */
export function toYaml(
  value: { [key: string]: YamlValue },
  comments: Record<string, string> = {}
): string {
  return entries(value, 0, comments).join("\n") + "\n";
}

/** The chat page slug for an agent name: lowercase words joined by hyphens. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
