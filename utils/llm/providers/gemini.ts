import { getSemanticsModelId, getWorkflowModelId } from '../config';
import { JsonSchema, LlmClient } from '../types';

type GenAiSdkModule = typeof import('@google/genai');

function cleanJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

function extractFirstJsonObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          return text.slice(start, index + 1);
        }
      }
    }
  }

  return null;
}

function parseObjectJson(text: string): Record<string, unknown> {
  const cleaned = cleanJson(text);
  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    // fall through to object-substring fallback
  }

  const candidate = extractFirstJsonObject(cleaned);
  if (!candidate) {
    throw new Error('Gemini returned non-object JSON.');
  }

  const parsed = JSON.parse(candidate);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Gemini returned non-object JSON.');
  }
  return parsed as Record<string, unknown>;
}

function resolveApiKey(): string | undefined {
  const viteEnv = (import.meta as any)?.env || {};
  return viteEnv?.VITE_GEMINI_API_KEY;
}

function mapSchemaType(typeValue: string, Type: GenAiSdkModule['Type']): unknown {
  switch (typeValue) {
    case 'object':
      return Type.OBJECT;
    case 'array':
      return Type.ARRAY;
    case 'string':
      return Type.STRING;
    case 'number':
      return Type.NUMBER;
    case 'integer':
      return Type.INTEGER;
    case 'boolean':
      return Type.BOOLEAN;
    default:
      return typeValue;
  }
}

function convertToGeminiSchema(value: unknown, Type: GenAiSdkModule['Type']): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => convertToGeminiSchema(entry, Type));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(input)) {
    if (key === 'type' && typeof raw === 'string') {
      output[key] = mapSchemaType(raw, Type);
      continue;
    }

    output[key] = convertToGeminiSchema(raw, Type);
  }

  return output;
}

async function loadGenAiSdk(): Promise<GenAiSdkModule> {
  return import('@google/genai');
}

async function getClient() {
  const { GoogleGenAI } = await loadGenAiSdk();
  const apiKey = resolveApiKey();

  if (!apiKey) {
    throw new Error('Missing VITE_GEMINI_API_KEY');
  }

  return new GoogleGenAI({ apiKey });
}

async function generateJson(model: string, prompt: string, schema: JsonSchema): Promise<Record<string, unknown>> {
  const [sdk, ai] = await Promise.all([loadGenAiSdk(), getClient()]);
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: convertToGeminiSchema(schema, sdk.Type) as Record<string, unknown>,
    },
  });

  if (!response.text) {
    throw new Error('Gemini returned empty response.');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseObjectJson(response.text);
  } catch (error) {
    throw new Error(`Gemini JSON parse failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  return parsed;
}

export class GeminiProvider implements LlmClient {
  providerId = 'gemini';

  async generateSemantics(prompt: string, schema: JsonSchema): Promise<Record<string, unknown>> {
    return generateJson(getSemanticsModelId('gemini'), prompt, schema);
  }

  async generateWorkflowPlan(prompt: string, schema: JsonSchema): Promise<Record<string, unknown>> {
    return generateJson(getWorkflowModelId('gemini'), prompt, schema);
  }
}
