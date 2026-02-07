import { EvidenceItem, EvidencePack, Facts } from '../types';

const TARGET_HEADING_TOKENS = ['when', 'usage', 'input', 'output', 'requirement', 'setup'];

function stripFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return normalized;
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return normalized;
  return normalized.slice(end + 5);
}

function firstParagraphs(body: string, count: number): string {
  const blocks = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => !block.startsWith('#'));
  return blocks.slice(0, count).join('\n\n').trim();
}

function splitSections(body: string): Array<{ heading: string; content: string }> {
  const lines = body.split(/\r?\n/);
  const sections: Array<{ heading: string; content: string }> = [];

  let currentHeading = 'Document';
  let buffer: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      sections.push({ heading: currentHeading, content: buffer.join('\n').trim() });
      currentHeading = headingMatch[1].trim();
      buffer = [];
      continue;
    }
    buffer.push(line);
  }

  sections.push({ heading: currentHeading, content: buffer.join('\n').trim() });
  return sections.filter((section) => section.content);
}

function hashSnippet(input: string): string {
  let hash = 5381;
  for (let idx = 0; idx < input.length; idx += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(idx);
  }
  return (hash >>> 0).toString(16);
}

function findLineRange(source: string, snippet: string): { lineStart: number; lineEnd: number } {
  const normalizedSource = source.replace(/\r\n/g, '\n');
  const normalizedSnippet = snippet.replace(/\r\n/g, '\n').trim();
  if (!normalizedSnippet) return { lineStart: 1, lineEnd: 1 };

  const index = normalizedSource.indexOf(normalizedSnippet);
  if (index === -1) return { lineStart: 1, lineEnd: 1 };

  const prefix = normalizedSource.slice(0, index);
  const start = prefix.split('\n').length;
  const lineCount = normalizedSnippet.split('\n').length;
  return {
    lineStart: start,
    lineEnd: start + lineCount - 1,
  };
}

function makeEvidenceItem(
  kind: EvidenceItem['kind'],
  label: string,
  content: string,
  file: string,
  source: string,
): EvidenceItem {
  const range = findLineRange(source, content);
  return {
    kind,
    label,
    content,
    file,
    lineStart: range.lineStart,
    lineEnd: range.lineEnd,
    snippetHash: hashSnippet(`${file}:${range.lineStart}:${content}`),
  };
}

function selectKeySections(body: string): Array<{ heading: string; content: string }> {
  const sections = splitSections(body);
  const picks: Array<{ heading: string; content: string }> = [];

  for (const section of sections) {
    const headingLower = section.heading.toLowerCase();
    if (!TARGET_HEADING_TOKENS.some((token) => headingLower.includes(token))) {
      continue;
    }

    picks.push({
      heading: section.heading,
      content: section.content.slice(0, 700),
    });

    if (picks.length >= 5) break;
  }

  return picks;
}

function pickFirstCodeBlock(body: string): string | null {
  const match = body.match(/```[\w-]*\n([\s\S]*?)```/);
  if (!match) return null;
  return match[1].trim().slice(0, 700);
}

function summarizeScripts(facts: Facts): string | null {
  if (!facts.scriptCommandSummary.length) return null;

  const lines = facts.scriptCommandSummary.map((script) => {
    const commandSummary = script.topCommands.join(', ') || 'no commands detected';
    return `${script.path} | ${script.kind} | ${script.shebang ?? 'no shebang'} | ${commandSummary}`;
  });

  return lines.join('\n').slice(0, 1400);
}

function renderEvidenceText(items: EvidenceItem[]): string {
  return items
    .map(
      (item) =>
        `[${item.kind}] ${item.label} (${item.file}:${item.lineStart}-${item.lineEnd}, hash:${item.snippetHash})\n${item.content}`,
    )
    .join('\n\n---\n\n');
}

export function buildEvidencePack(bundleId: string, skillContent: string, facts: Facts): EvidencePack {
  const body = stripFrontmatter(skillContent);
  const items: EvidenceItem[] = [];

  const intro = firstParagraphs(body, 2);
  if (intro) {
    items.push(makeEvidenceItem('intro', 'Intro', intro.slice(0, 900), facts.filePath, skillContent));
  }

  for (const section of selectKeySections(body)) {
    items.push(makeEvidenceItem('heading', section.heading, section.content, facts.filePath, skillContent));
  }

  const code = pickFirstCodeBlock(body);
  if (code) {
    items.push(makeEvidenceItem('code', 'First code block', code, facts.filePath, skillContent));
  }

  const scripts = summarizeScripts(facts);
  if (scripts) {
    const scriptFile = facts.scriptCommandSummary[0]?.path ?? `${facts.rootPath}/scripts`;
    items.push(makeEvidenceItem('scripts', 'Scripts summary', scripts, scriptFile, scripts));
  }

  return {
    bundleId,
    items,
    asText: renderEvidenceText(items),
  };
}
