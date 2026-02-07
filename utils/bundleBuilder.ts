import { BundleAttachment, SkillBundle } from '../types';

interface MutableBundle {
  id: string;
  rootPath: string;
  skillMdFile: BundleAttachment;
  scriptsFiles: BundleAttachment[];
  referencesFiles: BundleAttachment[];
  assetsFiles: BundleAttachment[];
  otherFiles: BundleAttachment[];
}

const CANONICAL_SKILL_FILES = new Set(['skill.md']);

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function getDirname(filePath: string): string {
  const normalized = normalizePath(filePath);
  const idx = normalized.lastIndexOf('/');
  if (idx === -1) return '';
  return normalized.slice(0, idx);
}

function getLowerName(filePath: string): string {
  const normalized = normalizePath(filePath);
  return normalized.split('/').pop()?.toLowerCase() ?? '';
}

function rankSkillFile(filePath: string): number {
  const name = getLowerName(filePath);
  if (name === 'skill.md') return 2;
  return 0;
}

function asAttachment(file: File): BundleAttachment {
  return {
    path: normalizePath(file.webkitRelativePath || file.name),
    file,
  };
}

function classifyWithinRoot(root: string, fullPath: string): 'scripts' | 'references' | 'assets' | 'other' {
  const relative = fullPath.startsWith(`${root}/`) ? fullPath.slice(root.length + 1) : '';
  const lowerRelative = relative.toLowerCase();

  if (lowerRelative.startsWith('scripts/')) return 'scripts';
  if (lowerRelative.startsWith('references/')) return 'references';
  if (lowerRelative.startsWith('assets/')) return 'assets';
  return 'other';
}

function findLongestRoot(path: string, roots: string[]): string | null {
  let winner: string | null = null;

  for (const root of roots) {
    if (path === root || path.startsWith(`${root}/`)) {
      if (!winner || root.length > winner.length) {
        winner = root;
      }
    }
  }

  return winner;
}

export function buildSkillBundles(fileList: FileList): SkillBundle[] {
  const files = Array.from(fileList);
  const attachments = files.map(asAttachment);

  // Pass 1: find canonical skill roots and the best SKILL file per root.
  const rootToSkillFile = new Map<string, BundleAttachment>();
  for (const attachment of attachments) {
    const lowerName = getLowerName(attachment.path);
    if (!CANONICAL_SKILL_FILES.has(lowerName)) continue;

    const root = getDirname(attachment.path);
    const existing = rootToSkillFile.get(root);
    if (!existing || rankSkillFile(attachment.path) >= rankSkillFile(existing.path)) {
      rootToSkillFile.set(root, attachment);
    }
  }

  const roots = Array.from(rootToSkillFile.keys()).sort((a, b) => b.length - a.length);
  const bundles = new Map<string, MutableBundle>();

  for (const [rootPath, skillMdFile] of rootToSkillFile.entries()) {
    bundles.set(rootPath, {
      id: rootPath,
      rootPath,
      skillMdFile,
      scriptsFiles: [],
      referencesFiles: [],
      assetsFiles: [],
      otherFiles: [],
    });
  }

  // Pass 2: assign each file to the longest matching root.
  for (const attachment of attachments) {
    const root = findLongestRoot(attachment.path, roots);
    if (!root) continue;

    const bundle = bundles.get(root);
    if (!bundle) continue;

    if (attachment.path === bundle.skillMdFile.path) {
      continue;
    }

    const bucket = classifyWithinRoot(root, attachment.path);
    if (bucket === 'scripts') {
      bundle.scriptsFiles.push(attachment);
    } else if (bucket === 'references') {
      bundle.referencesFiles.push(attachment);
    } else if (bucket === 'assets') {
      bundle.assetsFiles.push(attachment);
    } else {
      bundle.otherFiles.push(attachment);
    }
  }

  return Array.from(bundles.values())
    .map((bundle) => ({
      id: bundle.id,
      rootPath: bundle.rootPath,
      skillMdFile: bundle.skillMdFile,
      scriptsFiles: bundle.scriptsFiles,
      referencesFiles: bundle.referencesFiles,
      assetsFiles: bundle.assetsFiles,
      otherFiles: bundle.otherFiles,
    }))
    .sort((a, b) => a.rootPath.localeCompare(b.rootPath));
}
