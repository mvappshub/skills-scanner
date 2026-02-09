import { Semantics, WorkflowPlan } from '../../types';

export type JsonSchema = Record<string, unknown>;

export interface LlmClient {
  providerId: string;
  generateSemantics(prompt: string, schema: JsonSchema): Promise<Partial<Semantics>>;
  generateWorkflowPlan(prompt: string, schema: JsonSchema): Promise<Partial<WorkflowPlan>>;
  healthCheck?(): Promise<{ ok: boolean; detail?: string }>;
}
