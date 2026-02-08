import { EdgeType, GraphDropReasons, GraphMetrics, SkillGraph, SkillGraphEdge, SkillRecord, Stage } from '../types';
import { getArtifactInterfaceTags } from './tagVocabulary';

const STAGE_ORDER: Record<Stage, number> = {
  intake: 0,
  plan: 1,
  implement: 2,
  verify: 3,
  refactor: 4,
  security: 5,
  docs: 6,
  release: 7,
  other: 8,
};

const STOPLIST = new Set([
  'workflow',
  'planning',
  'tasks',
  'quality',
  'validation',
  'requirements',
]);

const ARTIFACT_INTERFACE_SET = new Set(getArtifactInterfaceTags());

const FIELD_WEIGHTS = {
  artifacts: 1.35,
  capabilities: 1.15,
} as const;

const SPECIFIC_DF_RATIO = 0.3;
const SPECIFIC_IDF_MIN = 1.7;
const ABS_THRESHOLD = 1.2;
const PERCENTILE_THRESHOLD = 0.7;
const ALTERNATIVE_SIMILARITY_MIN = 0.6;
const RECIPROCAL_SCORE_EPSILON = 0.12;

const TOP_K: Record<EdgeType, number> = {
  depends_on: 5,
  precedes: 5,
  complements: 5,
  alternative_to: 3,
};

const DIRECTED_TYPES = new Set<EdgeType>(['depends_on', 'precedes']);

interface EdgeCandidate {
  from: string;
  to: string;
  type: EdgeType;
  score: number;
  overlapTags: string[];
}

interface ReciprocalResolution {
  directed: EdgeCandidate[];
  promotedComplements: EdgeCandidate[];
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

function stageRank(stage: Stage | undefined): number {
  return STAGE_ORDER[stage || 'other'];
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map(normalizeToken).filter(Boolean)));
}

function intersectTags(left: string[], right: string[]): string[] {
  const rightSet = new Set(normalizeTags(right));
  return normalizeTags(left).filter((tag) => rightSet.has(tag));
}

function smoothIdf(n: number, df: number): number {
  return Math.log((n + 1) / (df + 1)) + 1;
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  const weight = index - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

function scoreTags(overlapTags: string[], idfByTag: Map<string, number>, fieldWeight: number): number {
  const scoredTags = overlapTags.filter((tag) => !STOPLIST.has(tag));
  if (!scoredTags.length) return 0;
  return scoredTags.reduce((sum, tag) => sum + (idfByTag.get(tag) ?? 0) * fieldWeight, 0);
}

function jaccardSimilarity(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 && b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function computeDf(skills: SkillRecord[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const skill of skills) {
    const unionTags = normalizeTags([...skill.inputsTags, ...skill.artifactsTags, ...skill.capabilitiesTags]);
    for (const tag of unionTags) {
      df.set(tag, (df.get(tag) || 0) + 1);
    }
  }
  return df;
}

function hasSpecificNonStopTag(tag: string, df: Map<string, number>, specificDfMax: number): boolean {
  if (STOPLIST.has(tag)) return false;
  return (df.get(tag) || Number.POSITIVE_INFINITY) <= specificDfMax;
}

function validateOverlapTags(
  overlapTags: string[],
  df: Map<string, number>,
  specificDfMax: number,
  dropReasons: GraphDropReasons,
  options: { artifactInterfaceOnly?: boolean } = {},
): string[] | null {
  if (overlapTags.length === 0) return null;

  const narrowedByInterface = options.artifactInterfaceOnly
    ? overlapTags.filter((tag) => ARTIFACT_INTERFACE_SET.has(tag))
    : overlapTags;
  if (!narrowedByInterface.length) {
    dropReasons.spec += 1;
    return null;
  }

  const nonStopTags = narrowedByInterface.filter((tag) => !STOPLIST.has(tag));
  if (nonStopTags.length === 0) {
    dropReasons.stoplist += 1;
    return null;
  }

  const hasSpecific = nonStopTags.some((tag) => hasSpecificNonStopTag(tag, df, specificDfMax));
  if (!hasSpecific) {
    dropReasons.spec += 1;
    return null;
  }

  return normalizeTags(nonStopTags);
}

function collectCandidates(
  skills: SkillRecord[],
  df: Map<string, number>,
  idfByTag: Map<string, number>,
  dropReasons: GraphDropReasons,
): EdgeCandidate[] {
  const candidates: EdgeCandidate[] = [];
  const n = skills.length;
  const specificDfMax = Math.max(1, Math.floor(n * SPECIFIC_DF_RATIO));

  for (const source of skills) {
    for (const target of skills) {
      if (source.id === target.id) continue;

      const dependsOverlap = validateOverlapTags(
        intersectTags(source.artifactsTags, target.inputsTags),
        df,
        specificDfMax,
        dropReasons,
        { artifactInterfaceOnly: true },
      );
      if (dependsOverlap) {
        const score = scoreTags(dependsOverlap, idfByTag, FIELD_WEIGHTS.artifacts);
        candidates.push({
          from: source.id,
          to: target.id,
          type: 'depends_on',
          score,
          overlapTags: dependsOverlap,
        });
      }

      if (STAGE_ORDER[source.stage] >= STAGE_ORDER[target.stage]) {
        dropReasons.stage += 1;
        continue;
      }

      const precedesOverlap = validateOverlapTags(
        intersectTags(source.artifactsTags, target.inputsTags),
        df,
        specificDfMax,
        dropReasons,
        { artifactInterfaceOnly: true },
      );
      if (!precedesOverlap) continue;

      const score = scoreTags(precedesOverlap, idfByTag, FIELD_WEIGHTS.artifacts);
      candidates.push({
        from: source.id,
        to: target.id,
        type: 'precedes',
        score,
        overlapTags: precedesOverlap,
      });
    }
  }

  for (let i = 0; i < skills.length; i += 1) {
    for (let j = i + 1; j < skills.length; j += 1) {
      const left = skills[i];
      const right = skills[j];

      const complementsOverlap = validateOverlapTags(
        intersectTags(left.capabilitiesTags, right.capabilitiesTags),
        df,
        specificDfMax,
        dropReasons,
      );
      if (complementsOverlap) {
        const hasHighIdfSpecific = complementsOverlap.some(
          (tag) => hasSpecificNonStopTag(tag, df, specificDfMax) && (idfByTag.get(tag) || 0) >= SPECIFIC_IDF_MIN,
        );

        if (!hasHighIdfSpecific) {
          dropReasons.spec += 1;
        } else {
          const score = scoreTags(complementsOverlap, idfByTag, FIELD_WEIGHTS.capabilities);
          candidates.push({
            from: left.id,
            to: right.id,
            type: 'complements',
            score,
            overlapTags: complementsOverlap,
          });
        }
      }

      if (Math.abs(STAGE_ORDER[left.stage] - STAGE_ORDER[right.stage]) > 1) {
        dropReasons.stage += 1;
        continue;
      }

      const leftCaps = normalizeTags(left.capabilitiesTags).filter((tag) => !STOPLIST.has(tag));
      const rightCaps = normalizeTags(right.capabilitiesTags).filter((tag) => !STOPLIST.has(tag));
      const similarity = jaccardSimilarity(leftCaps, rightCaps);
      if (similarity < ALTERNATIVE_SIMILARITY_MIN) {
        dropReasons.similarity += 1;
        continue;
      }

      const alternativeOverlap = validateOverlapTags(
        intersectTags(left.capabilitiesTags, right.capabilitiesTags),
        df,
        specificDfMax,
        dropReasons,
      );
      if (!alternativeOverlap) continue;

      const baseScore = scoreTags(alternativeOverlap, idfByTag, FIELD_WEIGHTS.capabilities);
      const score = baseScore * (1 + similarity);
      candidates.push({
        from: left.id,
        to: right.id,
        type: 'alternative_to',
        score,
        overlapTags: alternativeOverlap,
      });
    }
  }

  return candidates;
}

function resolveReciprocalDepends(
  candidates: EdgeCandidate[],
  skillsById: Map<string, SkillRecord>,
  dropReasons: GraphDropReasons,
): ReciprocalResolution {
  const nonDepends = candidates.filter((candidate) => candidate.type !== 'depends_on');
  const depends = candidates.filter((candidate) => candidate.type === 'depends_on');
  const byPair = new Map<string, EdgeCandidate[]>();

  for (const candidate of depends) {
    const pair = [candidate.from, candidate.to].sort();
    const key = `${pair[0]}<->${pair[1]}`;
    const bucket = byPair.get(key) || [];
    bucket.push(candidate);
    byPair.set(key, bucket);
  }

  const keptDepends: EdgeCandidate[] = [];
  const promotedComplements: EdgeCandidate[] = [];

  for (const bucket of byPair.values()) {
    if (bucket.length === 0) continue;
    if (bucket.length === 1) {
      keptDepends.push(bucket[0]);
      continue;
    }

    const bestByDirection = new Map<string, EdgeCandidate>();
    for (const candidate of bucket) {
      const key = `${candidate.from}->${candidate.to}`;
      const existing = bestByDirection.get(key);
      if (!existing || candidate.score > existing.score) {
        if (existing) {
          dropReasons.reciprocalDependsOn += 1;
        }
        bestByDirection.set(key, candidate);
      } else {
        dropReasons.reciprocalDependsOn += 1;
      }
    }

    const directionBest = Array.from(bestByDirection.values());
    if (directionBest.length === 1) {
      keptDepends.push(directionBest[0]);
      continue;
    }

    const [first, second] = directionBest.sort((a, b) =>
      `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`),
    );

    const firstDelta = stageRank(skillsById.get(first.to)?.stage) - stageRank(skillsById.get(first.from)?.stage);
    const secondDelta = stageRank(skillsById.get(second.to)?.stage) - stageRank(skillsById.get(second.from)?.stage);

    if (firstDelta > 0 && secondDelta <= 0) {
      keptDepends.push(first);
      dropReasons.reciprocalDependsOn += 1;
      continue;
    }
    if (secondDelta > 0 && firstDelta <= 0) {
      keptDepends.push(second);
      dropReasons.reciprocalDependsOn += 1;
      continue;
    }

    const scoreDelta = Math.abs(first.score - second.score);
    if (scoreDelta <= RECIPROCAL_SCORE_EPSILON) {
      const pair = [first.from, first.to].sort();
      const overlapTags = normalizeTags([...first.overlapTags, ...second.overlapTags]);
      promotedComplements.push({
        from: pair[0],
        to: pair[1],
        type: 'complements',
        score: (first.score + second.score) / 2,
        overlapTags,
      });
      dropReasons.reciprocalDependsOn += 2;
      continue;
    }

    const winner = first.score >= second.score ? first : second;
    keptDepends.push(winner);
    dropReasons.reciprocalDependsOn += 1;
  }

  return {
    directed: [...nonDepends, ...keptDepends],
    promotedComplements,
  };
}

function mergeUndirectedCandidates(candidates: EdgeCandidate[], type: EdgeType): EdgeCandidate[] {
  const byPair = new Map<string, EdgeCandidate>();

  for (const candidate of candidates) {
    if (candidate.type !== type) continue;
    const pair = [candidate.from, candidate.to].sort();
    const key = `${pair[0]}<->${pair[1]}`;
    const normalized: EdgeCandidate = {
      ...candidate,
      from: pair[0],
      to: pair[1],
      overlapTags: normalizeTags(candidate.overlapTags),
    };

    const existing = byPair.get(key);
    if (!existing) {
      byPair.set(key, normalized);
      continue;
    }

    byPair.set(key, {
      ...existing,
      score: Math.max(existing.score, normalized.score),
      overlapTags: normalizeTags([...existing.overlapTags, ...normalized.overlapTags]),
    });
  }

  return Array.from(byPair.values());
}

function thresholdCandidates(candidates: EdgeCandidate[], dropReasons: GraphDropReasons): { kept: EdgeCandidate[]; threshold: number } {
  const threshold = Math.max(ABS_THRESHOLD, percentile(candidates.map((candidate) => candidate.score), PERCENTILE_THRESHOLD));
  const kept: EdgeCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.score < threshold) {
      dropReasons.threshold += 1;
      continue;
    }
    kept.push(candidate);
  }

  return { kept, threshold };
}

function pruneDirected(candidates: EdgeCandidate[], dropReasons: GraphDropReasons): EdgeCandidate[] {
  const groups = new Map<string, EdgeCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.from}|${candidate.type}`;
    const bucket = groups.get(key) || [];
    bucket.push(candidate);
    groups.set(key, bucket);
  }

  const kept: EdgeCandidate[] = [];
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => b.score - a.score || a.to.localeCompare(b.to));
    const type = bucket[0]?.type;
    const limit = type ? TOP_K[type] : 0;

    for (let idx = 0; idx < bucket.length; idx += 1) {
      if (idx < limit) {
        kept.push(bucket[idx]);
      } else {
        dropReasons.topK += 1;
      }
    }
  }

  return kept;
}

function pruneUndirected(candidates: EdgeCandidate[], type: EdgeType, dropReasons: GraphDropReasons): EdgeCandidate[] {
  const limit = TOP_K[type];
  const sorted = candidates.slice().sort((a, b) => b.score - a.score || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const degreeByNode = new Map<string, number>();
  const kept: EdgeCandidate[] = [];

  for (const candidate of sorted) {
    const fromDegree = degreeByNode.get(candidate.from) || 0;
    const toDegree = degreeByNode.get(candidate.to) || 0;

    if (fromDegree >= limit || toDegree >= limit) {
      dropReasons.topK += 1;
      continue;
    }

    kept.push(candidate);
    degreeByNode.set(candidate.from, fromDegree + 1);
    degreeByNode.set(candidate.to, toDegree + 1);
  }

  return kept;
}

function buildChains(adjacency: Record<string, string[]>): string[][] {
  const hasIncoming = new Set<string>();
  for (const targets of Object.values(adjacency)) {
    for (const target of targets) {
      hasIncoming.add(target);
    }
  }

  const starts = Object.keys(adjacency).filter((node) => !hasIncoming.has(node));
  const chains: string[][] = [];

  const dfs = (node: string, path: string[]) => {
    const next = adjacency[node] || [];
    if (!next.length) {
      chains.push(path);
      return;
    }

    for (const candidate of next.slice(0, 4)) {
      if (path.includes(candidate)) continue;
      dfs(candidate, [...path, candidate]);
    }
  };

  for (const start of starts.slice(0, 30)) {
    dfs(start, [start]);
  }

  return chains
    .filter((chain) => chain.length > 1)
    .sort((a, b) => b.length - a.length)
    .slice(0, 20);
}

function buildMetrics(
  skills: SkillRecord[],
  edges: SkillGraphEdge[],
  relatedBySkill: Record<string, string[]>,
  inDegree: Record<string, number>,
  outDegree: Record<string, number>,
  dropReasons: GraphDropReasons,
  threshold: number,
  candidateCount: number,
): GraphMetrics {
  const distributionByType: Record<EdgeType, number> = {
    depends_on: 0,
    precedes: 0,
    complements: 0,
    alternative_to: 0,
  };

  for (const edge of edges) {
    distributionByType[edge.type] += 1;
  }

  const topDegreeNodes = skills
    .map((skill) => ({
      id: skill.id,
      degree: relatedBySkill[skill.id]?.length || 0,
      inDegree: inDegree[skill.id] || 0,
      outDegree: outDegree[skill.id] || 0,
    }))
    .sort((a, b) => b.degree - a.degree || b.outDegree - a.outDegree || a.id.localeCompare(b.id))
    .slice(0, 10);

  const edgeCount = edges.length;
  const n = skills.length;
  const density = n > 1 ? edgeCount / (n * (n - 1)) : 0;

  return {
    edgeCount,
    density,
    distributionByType,
    topDegreeNodes,
    dropReasons,
    threshold,
    candidateCount,
  };
}

function logGraphMetrics(edges: SkillGraphEdge[], metrics: GraphMetrics) {
  const overlapUsage = new Map<string, number>();
  for (const edge of edges) {
    for (const tag of edge.overlapTags) {
      overlapUsage.set(tag, (overlapUsage.get(tag) || 0) + 1);
    }
  }

  const topOverlapTags = Array.from(overlapUsage.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  console.log(
    `[graph] edgeCount=${metrics.edgeCount} density=${(metrics.density * 100).toFixed(2)}% threshold=${metrics.threshold.toFixed(3)} candidates=${metrics.candidateCount}`,
  );
  console.log('[graph] distribution by type:');
  console.table(metrics.distributionByType);
  console.log('[graph] top 10 nodes by degree:');
  console.table(metrics.topDegreeNodes);
  console.log('[graph] drop reasons:');
  console.table(metrics.dropReasons);
  console.log('[graph] top overlap tags:');
  console.table(topOverlapTags);
}

export function buildSkillGraph(skills: SkillRecord[]): SkillGraph {
  const adjacency: Record<string, string[]> = {};
  const relatedBySkill: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};
  const outDegree: Record<string, number> = {};

  for (const skill of skills) {
    adjacency[skill.id] = [];
    relatedBySkill[skill.id] = [];
    inDegree[skill.id] = 0;
    outDegree[skill.id] = 0;
  }

  const df = computeDf(skills);
  const idfByTag = new Map<string, number>();
  for (const [tag, count] of df.entries()) {
    idfByTag.set(tag, smoothIdf(skills.length, count));
  }

  const dropReasons: GraphDropReasons = {
    stoplist: 0,
    spec: 0,
    threshold: 0,
    topK: 0,
    stage: 0,
    similarity: 0,
    reciprocalDependsOn: 0,
  };

  const candidates = collectCandidates(skills, df, idfByTag, dropReasons);
  const { kept: thresholded, threshold } = thresholdCandidates(candidates, dropReasons);

  const directed = thresholded.filter((candidate) => DIRECTED_TYPES.has(candidate.type));
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const reciprocalResolution = resolveReciprocalDepends(directed, skillsById, dropReasons);
  const undirectedComplements = mergeUndirectedCandidates(
    [
      ...thresholded.filter((candidate) => candidate.type === 'complements'),
      ...reciprocalResolution.promotedComplements,
    ],
    'complements',
  );
  const undirectedAlternatives = thresholded.filter((candidate) => candidate.type === 'alternative_to');

  const keptCandidates = [
    ...pruneDirected(reciprocalResolution.directed, dropReasons),
    ...pruneUndirected(undirectedComplements, 'complements', dropReasons),
    ...pruneUndirected(mergeUndirectedCandidates(undirectedAlternatives, 'alternative_to'), 'alternative_to', dropReasons),
  ];

  const edges: SkillGraphEdge[] = keptCandidates
    .map((candidate) => ({
      from: candidate.from,
      to: candidate.to,
      type: candidate.type,
      score: Number(candidate.score.toFixed(4)),
      overlapTags: candidate.overlapTags,
      via: candidate.overlapTags,
    }))
    .sort((a, b) => b.score - a.score || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  for (const edge of edges) {
    const isDirected = DIRECTED_TYPES.has(edge.type);
    if (isDirected) {
      adjacency[edge.from].push(edge.to);
      outDegree[edge.from] += 1;
      inDegree[edge.to] += 1;
    }

    relatedBySkill[edge.from].push(edge.to);
    relatedBySkill[edge.to].push(edge.from);
  }

  for (const key of Object.keys(adjacency)) {
    adjacency[key] = Array.from(new Set(adjacency[key]));
    relatedBySkill[key] = Array.from(new Set(relatedBySkill[key]));
  }

  const metrics = buildMetrics(skills, edges, relatedBySkill, inDegree, outDegree, dropReasons, threshold, candidates.length);
  logGraphMetrics(edges, metrics);

  return {
    edges,
    adjacency,
    relatedBySkill,
    chains: buildChains(adjacency),
    metrics,
  };
}
