import { CategoryId, ConfidenceBasis, EvidencePack, Facts, MachineTagSemantics, Semantics, Stage } from '../types';
import { normalizeCategory } from './taxonomy';
import { sanitizeMachineTags, tagVocabularyForPrompt } from './tagVocabulary';

async function loadGenAISDK() {
  const module = await import('@google/genai');
  return module;
}

async function getClient() {
  const { GoogleGenAI } = await loadGenAISDK();
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing API key in process.env.API_KEY or process.env.GEMINI_API_KEY');
  }

  return new GoogleGenAI({ apiKey });
}

function cleanJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

function fallbackSemantics(facts: Facts): Semantics {
  const inferredStage: Stage = facts.riskLevel === 'danger' ? 'security' : 'other';
  return {
    oneLiner: facts.frontmatter.description || facts.canonicalName || 'Skill semantics unavailable',
    stage: inferredStage,
    humanReadable: {
      inputsText: [],
      artifactsText: [],
      capabilitiesText: [],
    },
    machineTags: {
      inputsTags: [],
      artifactsTags: [],
      capabilitiesTags: [],
    },
    prerequisites: facts.frontmatter.compatibility ?? [],
    constraints: [],
    sideEffects: facts.riskSignals,
    categoryId: 'general',
    confidence: 0.35,
    confidenceBasis: 'rules',
    evidence: [
      {
        field: 'fallback',
        quote: 'AI extraction failed; fallback from deterministic facts',
      },
    ],
    invalidTagIssues: [],
  };
}

function createPrompt(facts: Facts, evidence: EvidencePack, deep: boolean): string {
  return [
    'You are extracting workflow semantics for an Agent Skill.',
    'Return strict JSON only according to schema.',
    'Use only provided evidence and facts. Do not invent missing details.',
    '',
    'Facts:',
    JSON.stringify(
      {
        skillId: facts.skillId,
        rootPath: facts.rootPath,
        canonicalName: facts.canonicalName,
        frontmatter: facts.frontmatter,
        requires: facts.requires,
        mcpSignals: facts.mcpSignals,
        riskLevel: facts.riskLevel,
        riskSignals: facts.riskSignals,
      },
      null,
      2,
    ),
    '',
    'Evidence:',
    deep ? evidence.asText : evidence.items.slice(0, 4).map((item) => `${item.label}: ${item.content}`).join('\n\n'),
    '',
    'Required fields:',
    '- oneLiner: max 20 words',
    '- stage: one of intake, plan, implement, verify, refactor, security, docs, release, other',
    '- humanReadable.inputsText: 3-8 short descriptive phrases',
    '- humanReadable.artifactsText: 3-8 concrete deliverables (files/json/docs/prompts)',
    '- humanReadable.capabilitiesText: 3-8 abilities',
    `- machineTags.inputsTags: 3-8 canonical tags from allowed vocabulary only: ${tagVocabularyForPrompt()}`,
    `- machineTags.artifactsTags: 3-8 canonical tags from allowed vocabulary only: ${tagVocabularyForPrompt()}`,
    `- machineTags.capabilitiesTags: 3-8 canonical tags from allowed vocabulary only: ${tagVocabularyForPrompt()}`,
    '- prerequisites: assumptions/dependencies',
    '- constraints: limits/requirements',
    '- sideEffects: risky or consequential actions',
    '- categoryId: one of skill_dev, skill_docs, workflow_ops, agent_config, prompt_eng, security, ml_ops, general',
    '- confidence: 0..1',
    '- confidenceBasis: one of rules, llm, hybrid',
    '- evidence: list of objects [{ field, quote }]',
    '- Never invent new tags outside the allowed vocabulary.',
  ].join('\n');
}

function normalizeTextList(values: unknown, limit = 8): string[] {
  if (!Array.isArray(values)) return [];

  const normalized = values
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/\s+/g, ' '));

  return Array.from(new Set(normalized)).slice(0, limit);
}

function mergeMachineTags(primary: MachineTagSemantics, secondary: MachineTagSemantics): MachineTagSemantics {
  return {
    inputsTags: Array.from(new Set([...primary.inputsTags, ...secondary.inputsTags])).slice(0, 8),
    artifactsTags: Array.from(new Set([...primary.artifactsTags, ...secondary.artifactsTags])).slice(0, 8),
    capabilitiesTags: Array.from(new Set([...primary.capabilitiesTags, ...secondary.capabilitiesTags])).slice(0, 8),
  };
}

function sanitizeStage(value: string): Stage {
  const allowed: Stage[] = ['intake', 'plan', 'implement', 'verify', 'refactor', 'security', 'docs', 'release', 'other'];
  return (allowed.includes(value as Stage) ? value : 'other') as Stage;
}

function sanitizeCategory(value: string): CategoryId {
  return normalizeCategory(value);
}

function sanitizeConfidenceBasis(value: string): ConfidenceBasis {
  if (value === 'rules' || value === 'llm' || value === 'hybrid') {
    return value;
  }
  return 'llm';
}

export async function extractSemantics(
  facts: Facts,
  evidence: EvidencePack,
  options: { deep?: boolean } = {},
): Promise<Semantics> {
  const deep = options.deep ?? false;

  try {
    const { Type } = await loadGenAISDK();
    const ai = await getClient();

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: createPrompt(facts, evidence, deep),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            oneLiner: { type: Type.STRING },
            stage: { type: Type.STRING },
            humanReadable: {
              type: Type.OBJECT,
              properties: {
                inputsText: { type: Type.ARRAY, items: { type: Type.STRING } },
                artifactsText: { type: Type.ARRAY, items: { type: Type.STRING } },
                capabilitiesText: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['inputsText', 'artifactsText', 'capabilitiesText'],
            },
            machineTags: {
              type: Type.OBJECT,
              properties: {
                inputsTags: { type: Type.ARRAY, items: { type: Type.STRING } },
                artifactsTags: { type: Type.ARRAY, items: { type: Type.STRING } },
                capabilitiesTags: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['inputsTags', 'artifactsTags', 'capabilitiesTags'],
            },
            prerequisites: { type: Type.ARRAY, items: { type: Type.STRING } },
            constraints: { type: Type.ARRAY, items: { type: Type.STRING } },
            sideEffects: { type: Type.ARRAY, items: { type: Type.STRING } },
            categoryId: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            confidenceBasis: { type: Type.STRING },
            evidence: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  field: { type: Type.STRING },
                  quote: { type: Type.STRING },
                },
                required: ['field', 'quote'],
              },
            },
          },
          required: [
            'oneLiner',
            'stage',
            'humanReadable',
            'machineTags',
            'prerequisites',
            'constraints',
            'sideEffects',
            'categoryId',
            'confidence',
            'confidenceBasis',
            'evidence',
          ],
        },
      },
    });

    if (!response.text) {
      throw new Error('Empty AI response');
    }

    const parsed = JSON.parse(cleanJson(response.text)) as Partial<Semantics> & {
      stage?: string;
      categoryId?: string;
      confidenceBasis?: string;
      inputs?: string[];
      artifacts?: string[];
      capabilities?: string[];
    };

    const humanReadable = {
      inputsText: normalizeTextList(parsed.humanReadable?.inputsText ?? parsed.inputs),
      artifactsText: normalizeTextList(parsed.humanReadable?.artifactsText ?? parsed.artifacts),
      capabilitiesText: normalizeTextList(parsed.humanReadable?.capabilitiesText ?? parsed.capabilities),
    };

    const directMachineTags = sanitizeMachineTags(parsed.machineTags ?? {});
    const fallbackFromHuman = sanitizeMachineTags({
      inputsTags: humanReadable.inputsText,
      artifactsTags: humanReadable.artifactsText,
      capabilitiesTags: humanReadable.capabilitiesText,
    });

    const machineTags = mergeMachineTags(directMachineTags.machineTags, fallbackFromHuman.machineTags);
    const invalidTagIssues = directMachineTags.invalidTagIssues;

    return {
      oneLiner: parsed.oneLiner?.trim() || 'No summary',
      stage: sanitizeStage(parsed.stage || 'other'),
      humanReadable,
      machineTags,
      prerequisites: normalizeTextList(parsed.prerequisites, 10),
      constraints: normalizeTextList(parsed.constraints, 10),
      sideEffects: normalizeTextList(parsed.sideEffects, 10),
      categoryId: sanitizeCategory(parsed.categoryId || 'general'),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0))),
      confidenceBasis: sanitizeConfidenceBasis(parsed.confidenceBasis || 'llm'),
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 12) : [],
      invalidTagIssues,
    };
  } catch (error) {
    console.warn('Semantics extraction failed:', error);
    return fallbackSemantics(facts);
  }
}

export function shouldEscalateSemantics(semantics: Semantics): boolean {
  if (semantics.confidence < 0.55) return true;
  if (!semantics.stage || semantics.stage === 'other') return true;
  if (semantics.machineTags.inputsTags.length === 0 && semantics.humanReadable.inputsText.length === 0) return true;
  if (
    semantics.machineTags.artifactsTags.length === 0 &&
    semantics.machineTags.capabilitiesTags.length === 0 &&
    semantics.humanReadable.artifactsText.length === 0 &&
    semantics.humanReadable.capabilitiesText.length === 0
  ) {
    return true;
  }
  if (semantics.evidence.length < 2) return true;
  return false;
}
