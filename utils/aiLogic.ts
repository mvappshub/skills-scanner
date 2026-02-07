import { SkillRecord } from '../types';
import { analyzeSkill, deepAnalyzeSkill } from './scannerLogic';

export async function runPass1(record: SkillRecord): Promise<SkillRecord> {
  return analyzeSkill(record, { deep: false });
}

export async function runPass2(record: SkillRecord): Promise<SkillRecord> {
  return deepAnalyzeSkill(record);
}
