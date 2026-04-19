import { createHash } from "node:crypto";

const BLOCK_TAG_PATTERN =
  /<\/(p|div|section|article|header|footer|main|nav|aside|li|ul|ol|tr|td|th|h[1-6]|blockquote|pre|table)>/gi;

const LINE_BREAK_TAG_PATTERN = /<(br|hr)\s*\/?>/gi;
const STRIP_TAG_PATTERN = /<[^>]+>/g;

function decodeEntity(entity: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  };

  if (entity.startsWith("#x")) {
    const codePoint = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
  }

  if (entity.startsWith("#")) {
    const codePoint = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
  }

  return named[entity] ?? `&${entity};`;
}

function decodeEntities(text: string) {
  return text.replace(/&([a-zA-Z0-9#]+);/g, (_, entity: string) => decodeEntity(entity));
}

function collapseWhitespace(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripDangerousSections(html: string) {
  return html
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ");
}

function extractTitle(html: string) {
  const titleMatch =
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) ??
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(html) ??
    /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(html) ??
    /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);

  if (!titleMatch?.[1]) {
    return "";
  }

  return collapseWhitespace(
    decodeEntities(
      titleMatch[1]
        .replace(STRIP_TAG_PATTERN, " ")
        .replace(LINE_BREAK_TAG_PATTERN, " ")
        .replace(BLOCK_TAG_PATTERN, "\n")
    )
  );
}

function extractMainHtml(html: string) {
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return bodyMatch?.[1] ?? html;
}

export function normalizeHtmlContent(html: string, fallbackTitle = "") {
  const cleaned = stripDangerousSections(extractMainHtml(html));
  const title = extractTitle(html) || fallbackTitle;
  const text = collapseWhitespace(
    decodeEntities(
      cleaned
        .replace(LINE_BREAK_TAG_PATTERN, "\n")
        .replace(BLOCK_TAG_PATTERN, "\n")
        .replace(STRIP_TAG_PATTERN, " ")
    )
  );
  const excerpt = text.slice(0, 280);
  const contentHash = createHash("sha256").update(`${title}\n${text}`).digest("hex");

  return {
    title,
    text,
    excerpt,
    wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
    contentHash
  };
}
