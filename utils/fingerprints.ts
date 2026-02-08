import { SemanticsVersionMeta, SkillBundle } from '../types';
import { normalizePath } from './bundleBuilder';
import { SEMANTICS_LOGIC_VERSION, SEMANTICS_MODEL_ID, SEMANTICS_PROMPT_VERSION } from './semanticsAI';
import { TAG_VOCAB_VERSION } from './tagVocabulary';

export const SCANNER_VERSION = 'scanner-v1';

export function makeSemanticsMeta(skillMdHash: string): SemanticsVersionMeta {
  return {
    modelId: SEMANTICS_MODEL_ID,
    promptVersion: SEMANTICS_PROMPT_VERSION,
    vocabVersion: TAG_VOCAB_VERSION,
    logicVersion: SEMANTICS_LOGIC_VERSION,
    skillMdHash,
  };
}

function encodeUtf8(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encodeUtf8(input));
  return toHex(digest);
}

function sortedBundlePaths(bundle: SkillBundle): string[] {
  return [
    bundle.skillMdFile.path,
    ...bundle.scriptsFiles.map((entry) => entry.path),
    ...bundle.referencesFiles.map((entry) => entry.path),
    ...bundle.assetsFiles.map((entry) => entry.path),
    ...bundle.otherFiles.map((entry) => entry.path),
  ]
    .map((path) => normalizePath(path))
    .sort();
}

export async function computeBundleHash(bundle: SkillBundle): Promise<string> {
  const pathHash = await sha256Hex(sortedBundlePaths(bundle).join('\n'));
  return [
    pathHash,
    `scripts:${bundle.scriptsFiles.length}`,
    `references:${bundle.referencesFiles.length}`,
    `assets:${bundle.assetsFiles.length}`,
    `other:${bundle.otherFiles.length}`,
  ].join('|');
}

export async function computeFactsFingerprint(skillMdHash: string, bundleHash: string): Promise<string> {
  return sha256Hex([skillMdHash, bundleHash, SCANNER_VERSION].join('|'));
}

export async function computeSemanticsFingerprint(meta: SemanticsVersionMeta): Promise<string> {
  return sha256Hex(
    [
      meta.skillMdHash,
      meta.promptVersion,
      meta.vocabVersion,
      meta.modelId,
      meta.logicVersion,
    ].join('|'),
  );
}
