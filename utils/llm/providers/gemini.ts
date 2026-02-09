import { getSemanticsModelId, getWorkflowModelId } from '../config';
import { JsonSchema, LlmClient } from '../types';

type GenAiSdkModule = typeof import('@google/genai');

function cleanJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

function resolveApiKey(): string | undefined {
  const processEnv = typeof process !== 'undefined' ? (process as any)?.env : undefined;
  const viteEnv = (import.meta as any)?.env || {};

  return processEnv?.API_KEY || processEnv?.GEMINI_API_KEY || viteEnv?.VITE_API_KEY || viteEnv?.VITE_GEMINI_API_KEY;
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
    throw new Error('Missing Gemini API key (API_KEY / GEMINI_API_KEY / VITE_GEMINI_API_KEY).');
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

  const parsed = JSON.parse(cleanJson(response.text));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Gemini returned non-object JSON.');
  }

  return parsed as Record<string, unknown>;
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

