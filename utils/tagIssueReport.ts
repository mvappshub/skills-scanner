import { InvalidTagIssue, SkillRecord } from '../types';

export interface DroppedTagSummary {
  field: InvalidTagIssue['field'];
  rawTag: string;
  mappedTo?: string;
  reason?: InvalidTagIssue['reason'];
  count: number;
  recommendation: 'map' | 'allow' | 'keep_dropped';
}

function issueKey(issue: InvalidTagIssue): string {
  return `${issue.field}|${issue.rawTag}|${issue.mappedTo || ''}|${issue.reason || ''}`;
}

function recommend(issue: InvalidTagIssue, count: number): DroppedTagSummary['recommendation'] {
  if (issue.reason === 'artifact_evidence_missing') {
    return 'map';
  }
  if (issue.reason === 'field_not_allowed') {
    return count >= 3 ? 'allow' : 'map';
  }
  return 'keep_dropped';
}

export function summarizeDroppedTags(skills: SkillRecord[], limit = 50): DroppedTagSummary[] {
  const buckets = new Map<string, { issue: InvalidTagIssue; count: number }>();

  for (const skill of skills) {
    const issues = skill.semantics?.invalidTagIssues || [];
    for (const issue of issues) {
      if (!issue.reason) continue;
      const isDropped =
        issue.reason === 'field_not_allowed' ||
        issue.reason === 'artifact_evidence_missing' ||
        (issue.reason === 'unknown_tag' && !issue.mappedTo);
      if (!isDropped) continue;

      const key = issueKey(issue);
      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        buckets.set(key, { issue, count: 1 });
      }
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => b.count - a.count || a.issue.rawTag.localeCompare(b.issue.rawTag))
    .slice(0, limit)
    .map(({ issue, count }) => ({
      field: issue.field,
      rawTag: issue.rawTag,
      mappedTo: issue.mappedTo,
      reason: issue.reason,
      count,
      recommendation: recommend(issue, count),
    }));
}
