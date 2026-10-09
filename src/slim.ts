import { type Content, textBlock } from "boosty-api";

interface Block {
  type?: string;
  content?: string;
  modificator?: string;
  url?: string;
}

/**
 * Plain text of one text/link block. `content` is a Draft.js fragment serialized as
 * JSON: ["visible text", "unstyled", [...styles]]; a BLOCK_END block closes a paragraph.
 * (renderText of boosty-api drops BLOCK_END, gluing paragraphs together.)
 */
function blockText(block: Block): string {
  if (block.modificator === "BLOCK_END") return "\n";
  let text = "";
  try {
    text = String(JSON.parse(block.content ?? "")[0] ?? "");
  } catch {
    // Not a Draft.js fragment: nothing readable inside
  }
  return block.type === "link" && block.url && block.url !== text ? `${text} (${block.url})` : text;
}

/** The reverse of blockText: plain text → one text block per line, each closed by BLOCK_END. */
export function textBlocks(text: string): Content[] {
  const paragraphEnd = { type: "text", content: "", modificator: "BLOCK_END" };
  return text.split("\n").flatMap((line) => [textBlock(line), paragraphEnd]) as Content[];
}

const isTextual = (block: Block) => block?.type === "text" || block?.type === "link";

/**
 * Make an API response readable for a model: wherever an object carries Boosty content
 * blocks in `data` (posts, comments, messages, level descriptions), the text and link
 * blocks are replaced by one rendered `text` field. Media and file blocks stay in `data`.
 */
export function slim(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(slim);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) result[key] = slim(child);
  const blocks = result.data;
  if (Array.isArray(blocks) && blocks.some(isTextual)) {
    result.text = blocks.filter(isTextual).map(blockText).join("").trim();
    result.data = blocks.filter((block) => !isTextual(block));
  }
  return result;
}
