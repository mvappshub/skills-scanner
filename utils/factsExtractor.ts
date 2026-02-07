import { Facts, FrontmatterData, FrontmatterValidation, RequiresProfile, ScriptSummary, SkillBundle } from '../types';

const MCP_PATTERNS = [/mcp-server/i, /@modelcontextprotocol/i, /mcpservers?/i, /model context protocol/i, /input_schema/i];

const RISK_PATTERNS: Record<string, RegExp[]> = {
  destructive: [/rm\s+(-r?f|-[a-z]*f)/i, /shutil\.rmtree/i, /fs\.rmSync/i, /os\.remove/i],
  shell: [/os\.system/i, /subprocess\.run/i, /child_process/i, /exec\(/i, /spawn\(/i],
  network: [/curl\s+/i, /wget\s+/i, /requests\.(get|post|put|delete)/i, /fetch\(/i, /axios\./i],
  secrets: [/api[_-]?key/i, /password/i, /secret/i, /bearer\s+token/i, /private[_-]?key/i],
};

const SCRIPT_KIND_BY_EXTENSION: Record<string, string> = {
  '.py': 'python',
  '.sh': 'bash',
  '.js': 'node',
  '.ts': 'typescript',
  '.ps1': 'powershell',
  '.rb': 'ruby',
  '.go': 'go',
  '.bat': 'batch',
};

const TOOL_SIGNAL_PATTERNS: Record<string, RegExp> = {
  git: /\bgit\b/i,
  docker: /\bdocker\b/i,
  npm: /\bnpm\b/i,
  node: /\bnode\b/i,
  python: /\bpython\b/i,
  uv: /\buv\b/i,
};

const RUNTIME_SIGNAL_PATTERNS: Record<string, RegExp> = {
  node: /\bnode\b|\.js\b|\.ts\b/i,
  python: /\bpython\b|\.py\b/i,
  shell: /\bbash\b|\.sh\b/i,
  powershell: /\bpowershell\b|\.ps1\b/i,
};

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---\n') && !trimmed.startsWith('---\r\n')) {
    return { frontmatter: '', body: content };
  }

  const normalized = content.replace(/\r\n/g, '\n');
  const endIndex = normalized.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return { frontmatter: '', body: content };
  }

  const frontmatter = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + 5);
  return { frontmatter, body };
}

function parseListValue(raw: string): string[] {
  const value = raw.trim();
  if (!value) return [];
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return [value.replace(/^['"]|['"]$/g, '')].filter(Boolean);
}

export function normalizeSkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
}

export function parseFrontmatter(content: string): {
  data: FrontmatterData;
  validation: FrontmatterValidation;
  body: string;
} {
  const { frontmatter, body } = splitFrontmatter(content);
  const data: FrontmatterData = { metadata: {} };
  const warnings: string[] = [];

  if (!frontmatter) {
    return {
      data,
      validation: {
        hasFrontmatter: false,
        hasName: false,
        hasDescription: false,
        warnings: ['Missing YAML frontmatter'],
      },
      body,
    };
  }

  const lines = frontmatter.split('\n');
  let activeListKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('-') && activeListKey) {
      const existing = (data.metadata?.[activeListKey] ?? []) as string[];
      const value = line.replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '');
      data.metadata![activeListKey] = [...existing, value];
      continue;
    }

    activeListKey = null;
    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    const normalizedKey = key.toLowerCase();

    if (!value) {
      activeListKey = normalizedKey;
      data.metadata![normalizedKey] = [];
      continue;
    }

    if (['name', 'title', 'skill_name'].includes(normalizedKey)) {
      data.name = value.replace(/^['"]|['"]$/g, '');
      continue;
    }

    if (['description', 'summary', 'desc'].includes(normalizedKey)) {
      data.description = value.replace(/^['"]|['"]$/g, '');
      continue;
    }

    if (['compatibility', 'compatibilities'].includes(normalizedKey)) {
      data.compatibility = parseListValue(value);
      continue;
    }

    if (['allowed-tools', 'allowed_tools', 'tools'].includes(normalizedKey)) {
      data.allowedTools = parseListValue(value);
      continue;
    }

    const listValue = parseListValue(value);
    data.metadata![normalizedKey] = listValue.length === 1 ? listValue[0] : listValue;
  }

  if (!data.name) warnings.push('Frontmatter missing required field: name');
  if (!data.description) warnings.push('Frontmatter missing required field: description');

  return {
    data,
    validation: {
      hasFrontmatter: true,
      hasName: Boolean(data.name),
      hasDescription: Boolean(data.description),
      warnings,
    },
    body,
  };
}

function detectMcpSignals(content: string): string[] {
  const lower = content.toLowerCase();
  const signals = new Set<string>();

  for (const pattern of MCP_PATTERNS) {
    if (pattern.test(lower)) {
      signals.add(pattern.source.replace(/\\/g, ''));
    }
  }

  const knownServers = ['github', 'notion', 'sqlite', 'postgres', 'filesystem', 'slack', 'linear', 'fetch'];
  for (const server of knownServers) {
    if (lower.includes(server) && lower.includes('mcp')) {
      signals.add(server);
    }
  }

  return Array.from(signals);
}

function evaluateRisk(mainContent: string, scriptsContent: string): Pick<Facts, 'riskLevel' | 'riskSignals'> {
  const corpus = `${mainContent}\n${scriptsContent}`;
  const hitKeys: string[] = [];

  for (const [key, patterns] of Object.entries(RISK_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(corpus))) {
      hitKeys.push(key);
    }
  }

  if (hitKeys.includes('destructive')) {
    return { riskLevel: 'danger', riskSignals: hitKeys };
  }
  if (hitKeys.length > 0) {
    return { riskLevel: 'warning', riskSignals: hitKeys };
  }
  return { riskLevel: 'safe', riskSignals: [] };
}

function inferScriptKind(path: string): string {
  const match = path.match(/\.[a-z0-9]+$/i);
  if (!match) return 'unknown';
  return SCRIPT_KIND_BY_EXTENSION[match[0].toLowerCase()] ?? match[0].slice(1);
}

function summarizeCommands(script: string): string[] {
  const lines = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const commands: string[] = [];
  for (const line of lines) {
    const token = line.split(/\s+/)[0];
    if (!token) continue;
    if (/^[\w./-]+$/.test(token)) {
      commands.push(token);
    }
    if (commands.length >= 5) break;
  }

  return Array.from(new Set(commands));
}

async function summarizeScripts(bundle: SkillBundle): Promise<{ summaries: ScriptSummary[]; combined: string; names: string[] }> {
  const summaries: ScriptSummary[] = [];
  const chunks: string[] = [];
  const names: string[] = [];

  for (const script of bundle.scriptsFiles) {
    const text = await script.file.text();
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    summaries.push({
      path: script.path,
      kind: inferScriptKind(script.path),
      shebang: firstLine.startsWith('#!') ? firstLine : null,
      topCommands: summarizeCommands(text),
    });
    chunks.push(text.slice(0, 2000));
    names.push(script.path.split('/').pop() || script.path);
  }

  return { summaries, combined: chunks.join('\n'), names };
}

function inferRequires(content: string, scripts: ScriptSummary[], mcpSignals: string[], riskSignals: string[]): RequiresProfile {
  const corpus = `${content}\n${scripts.map((script) => script.topCommands.join(' ')).join('\n')}`;
  const tools = new Set<string>();
  const runtimes = new Set<string>();

  for (const [tool, pattern] of Object.entries(TOOL_SIGNAL_PATTERNS)) {
    if (pattern.test(corpus)) tools.add(tool);
  }

  for (const [runtime, pattern] of Object.entries(RUNTIME_SIGNAL_PATTERNS)) {
    if (pattern.test(corpus)) runtimes.add(runtime);
  }

  const secrets = riskSignals.includes('secrets') ? ['secret-like tokens detected'] : [];
  const network = riskSignals.includes('network') || /https?:\/\//i.test(corpus);

  return {
    scripts: scripts.length > 0,
    mcp: mcpSignals.length > 0,
    network,
    tools: Array.from(tools),
    runtimes: Array.from(runtimes),
    secrets,
  };
}

function validateIdentity(name: string, folderName: string) {
  const normalized = normalizeSkillName(name);
  const folderNormalized = normalizeSkillName(folderName);
  const nameValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);

  return {
    nameValid,
    nameMatchesFolder: normalized === folderNormalized,
    normalized,
  };
}

export async function extractFacts(bundle: SkillBundle, skillContent: string, repoId: string): Promise<Facts> {
  const { data, validation } = parseFrontmatter(skillContent);
  const scripts = await summarizeScripts(bundle);
  const mcpSignals = detectMcpSignals(skillContent);
  const risk = evaluateRisk(skillContent, scripts.combined);
  const folderName = bundle.rootPath.split('/').pop() || bundle.rootPath;
  const canonicalName = data.name || folderName;
  const identity = validateIdentity(canonicalName, folderName);
  const skillId = `${repoId}:${bundle.rootPath}`;
  const requires = inferRequires(skillContent, scripts.summaries, mcpSignals, risk.riskSignals);

  return {
    bundleId: bundle.id,
    skillId,
    repoId,
    rootPath: bundle.rootPath,
    folderName,
    filePath: bundle.skillMdFile.path,
    canonicalName,
    canonicalNameNormalized: identity.normalized,
    frontmatter: data,
    frontmatterValidation: validation,
    identityValidation: {
      nameValid: identity.nameValid,
      nameMatchesFolder: identity.nameMatchesFolder,
    },
    hasScripts: bundle.scriptsFiles.length > 0,
    scriptNames: scripts.names,
    scriptCommandSummary: scripts.summaries,
    mcpSignals,
    riskLevel: risk.riskLevel,
    riskSignals: risk.riskSignals,
    requires,
  };
}
