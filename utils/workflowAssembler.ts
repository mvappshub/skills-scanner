import {
  EdgeType,
  SkillGraph,
  SkillRecord,
  SkillWorkflowAssembly,
  Stage,
  WorkflowPlan,
  WorkflowPlanStep,
  WorkflowFeedbackRecord,
  WorkflowSkillCandidate,
} from '../types';
import { buildSkillGraph } from './graphBuilder';

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

const MAX_ALTERNATIVES = 3;
const MIN_SELECTABLE_SCORE = 1.15;

interface StepEvaluation {
  candidate: WorkflowSkillCandidate;
  score: number;
  matchedTags: string[];
  missingTags: string[];
  graphBoost: number;
}

interface AssemblerGraphOptions {
  graph?: SkillGraph | null;
  alternativesLimit?: number;
  lockedSkillByStepId?: Record<string, string>;
  feedbackEntries?: WorkflowFeedbackRecord[];
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)));
}

function intersectTags(left: string[], right: string[]): string[] {
  const rightSet = new Set(normalizeTags(right));
  return normalizeTags(left).filter((tag) => rightSet.has(tag));
}

function toEdgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

function stageDistance(a: Stage, b: Stage): number {
  return Math.abs(STAGE_ORDER[a] - STAGE_ORDER[b]);
}

function scoreStage(stepStage: Stage, skillStage: Stage): number {
  const distance = stageDistance(stepStage, skillStage);
  if (distance === 0) return 2;
  if (distance === 1) return 1;
  if (distance === 2) return 0.3;
  return 0;
}

function buildEdgeLookup(graph: SkillGraph): Map<string, Set<EdgeType>> {
  const lookup = new Map<string, Set<EdgeType>>();
  for (const edge of graph.edges) {
    const key = toEdgeKey(edge.from, edge.to);
    const bucket = lookup.get(key) || new Set<EdgeType>();
    bucket.add(edge.type);
    lookup.set(key, bucket);
  }
  return lookup;
}

function emptyGraph(): SkillGraph {
  return {
    edges: [],
    adjacency: {},
    relatedBySkill: {},
    chains: [],
    metrics: {
      edgeCount: 0,
      density: 0,
      distributionByType: {
        depends_on: 0,
        precedes: 0,
        complements: 0,
        alternative_to: 0,
      },
      topDegreeNodes: [],
      dropReasons: {
        stoplist: 0,
        spec: 0,
        threshold: 0,
        topK: 0,
        stage: 0,
        similarity: 0,
        reciprocalDependsOn: 0,
      },
      threshold: 0,
      candidateCount: 0,
    },
  };
}

function scoreToConfidence(score: number): number {
  const confidence = 1 / (1 + Math.exp(-0.75 * (score - 2.4)));
  return Math.max(0, Math.min(1, Number(confidence.toFixed(4))));
}

function jaccardSimilarity(left: string[], right: string[]): number {
  const leftSet = new Set(normalizeTags(left));
  const rightSet = new Set(normalizeTags(right));
  if (leftSet.size === 0 && rightSet.size === 0) return 0;

  let intersection = 0;
  for (const tag of leftSet) {
    if (rightSet.has(tag)) {
      intersection += 1;
    }
  }

  const union = leftSet.size + rightSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function feedbackBiasForCandidate(
  step: WorkflowPlanStep,
  skill: SkillRecord,
  feedbackEntries: WorkflowFeedbackRecord[] | undefined,
): { bias: number; votes: number } {
  if (!feedbackEntries || feedbackEntries.length === 0) {
    return { bias: 0, votes: 0 };
  }

  const stepTags = normalizeTags([...(step.inputsTags || []), ...(step.outputsTags || []), ...(step.capabilitiesTags || [])]);
  let total = 0;
  let votes = 0;

  for (const feedback of feedbackEntries) {
    if (feedback.skillId !== skill.id) continue;

    const stageWeight = feedback.stepStage === step.stage ? 1 : 0.35;
    const similarity = jaccardSimilarity(stepTags, feedback.expectedTags || []);
    const confidence = 0.2 + similarity * 0.8;
    const sourceWeight = feedback.candidateType === 'selected' ? 1 : 0.8;
    total += feedback.rating * stageWeight * confidence * sourceWeight;
    votes += 1;
  }

  return {
    bias: Math.max(-1.6, Math.min(1.6, Number(total.toFixed(4)))),
    votes,
  };
}

function evaluateCandidate(
  step: WorkflowPlanStep,
  skill: SkillRecord,
  previousSelected: SkillRecord | null,
  edgeLookup: Map<string, Set<EdgeType>>,
  feedbackEntries: WorkflowFeedbackRecord[] | undefined,
): StepEvaluation {
  const stepInputs = normalizeTags(step.inputsTags);
  const stepOutputs = normalizeTags(step.outputsTags);
  const stepCapabilities = normalizeTags(step.capabilitiesTags || []);

  const skillInputs = normalizeTags(skill.inputsTags);
  const skillOutputs = normalizeTags(skill.artifactsTags);
  const skillCapabilities = normalizeTags(skill.capabilitiesTags);

  const inputMatches = intersectTags(stepInputs, [...skillInputs, ...skillCapabilities]);
  const outputMatches = intersectTags(stepOutputs, skillOutputs);
  const capabilityMatches = intersectTags(stepCapabilities, skillCapabilities);

  let score = scoreStage(step.stage, skill.stage);
  score += inputMatches.length * 1.15;
  score += outputMatches.length * 1.35;
  score += capabilityMatches.length * 1.1;

  let graphBoost = 0;
  const reasoningParts: string[] = [];
  if (scoreStage(step.stage, skill.stage) > 0) {
    reasoningParts.push(`stage ${step.stage}~${skill.stage}`);
  }
  if (inputMatches.length) reasoningParts.push(`inputs: ${inputMatches.join(', ')}`);
  if (outputMatches.length) reasoningParts.push(`outputs: ${outputMatches.join(', ')}`);
  if (capabilityMatches.length) reasoningParts.push(`capabilities: ${capabilityMatches.join(', ')}`);

  if (previousSelected) {
    const flowOverlap = intersectTags(previousSelected.artifactsTags, skillInputs);
    if (flowOverlap.length) {
      graphBoost += flowOverlap.length * 0.75;
      reasoningParts.push(`prev artifacts->inputs: ${flowOverlap.join(', ')}`);
    }

    const priorEdgeTypes = edgeLookup.get(toEdgeKey(previousSelected.id, skill.id));
    if (priorEdgeTypes?.has('depends_on')) {
      graphBoost += 1.6;
      reasoningParts.push('graph depends_on');
    } else if (priorEdgeTypes?.has('precedes')) {
      graphBoost += 1.1;
      reasoningParts.push('graph precedes');
    }
  }

  const feedback = feedbackBiasForCandidate(step, skill, feedbackEntries);
  if (feedback.bias !== 0) {
    score += feedback.bias;
    reasoningParts.push(`feedback ${feedback.bias > 0 ? '+' : ''}${feedback.bias.toFixed(2)} (${feedback.votes} votes)`);
  }

  score += graphBoost;

  const requiredTags = normalizeTags([...stepInputs, ...stepOutputs, ...stepCapabilities]);
  const coveredTags = normalizeTags([...inputMatches, ...outputMatches, ...capabilityMatches]);
  const coveredSet = new Set(coveredTags);
  const missingTags = requiredTags.filter((tag) => !coveredSet.has(tag));
  const matchedTags = coveredTags;

  const candidate: WorkflowSkillCandidate = {
    skillId: skill.id,
    name: skill.name,
    stage: skill.stage,
    score: Number(score.toFixed(4)),
    confidence: scoreToConfidence(score),
    matchedTags,
    reasoning: reasoningParts.length ? reasoningParts.join(' | ') : 'low tag overlap',
  };

  return {
    candidate,
    score,
    matchedTags,
    missingTags,
    graphBoost,
  };
}

export function assembleWorkflow(
  plan: WorkflowPlan,
  skills: SkillRecord[],
  options: AssemblerGraphOptions = {},
): SkillWorkflowAssembly {
  const graph =
    options.graph === null
      ? emptyGraph()
      : options.graph ?? buildSkillGraph(skills);
  const edgeLookup = buildEdgeLookup(graph);
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const alternativesLimit = options.alternativesLimit ?? MAX_ALTERNATIVES;

  const selected: WorkflowSkillCandidate[] = [];
  const alternatives: Record<string, WorkflowSkillCandidate[]> = {};
  const reasoning: Record<string, string> = {};
  const steps: SkillWorkflowAssembly['steps'] = [];
  const missingGlobal = new Set<string>();

  let previousSelected: SkillRecord | null = null;

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index];
    const stepId = step.id || `step-${index + 1}`;
    const title = step.title || `${step.stage} step ${index + 1}`;
    const lockedSkillId = options.lockedSkillByStepId?.[stepId] || null;

    const evaluations = skills
      .map((skill) => evaluateCandidate(step, skill, previousSelected, edgeLookup, options.feedbackEntries))
      .sort((a, b) => b.score - a.score || a.candidate.skillId.localeCompare(b.candidate.skillId));
    const evaluationBySkillId = new Map(evaluations.map((entry) => [entry.candidate.skillId, entry]));
    const lockedEvaluation = lockedSkillId ? evaluationBySkillId.get(lockedSkillId) || null : null;

    const selectable = evaluations.filter(
      (entry) => entry.score >= MIN_SELECTABLE_SCORE && (entry.matchedTags.length > 0 || entry.graphBoost > 0),
    );

    const winner = lockedEvaluation || selectable[0] || null;
    const winnerCandidate = winner
      ? {
          ...winner.candidate,
          reasoning: lockedEvaluation ? `locked selection | ${winner.candidate.reasoning}` : winner.candidate.reasoning,
        }
      : null;
    const stepAlternatives = selectable
      .filter((entry) => entry.candidate.skillId !== winnerCandidate?.skillId)
      .slice(0, alternativesLimit)
      .map((entry) => entry.candidate);
    const missingTags = winner ? winner.missingTags : normalizeTags([...step.inputsTags, ...step.outputsTags, ...(step.capabilitiesTags || [])]);
    const overlapTags = winner ? winner.matchedTags : [];

    for (const tag of missingTags) {
      missingGlobal.add(tag);
    }

    if (winnerCandidate) {
      selected.push(winnerCandidate);
      reasoning[stepId] = winnerCandidate.reasoning;
      previousSelected = skillsById.get(winnerCandidate.skillId) || null;
    } else {
      reasoning[stepId] = 'No candidate met minimum score/overlap constraints';
      previousSelected = null;
    }

    alternatives[stepId] = stepAlternatives;
    steps.push({
      stepId,
      title,
      stage: step.stage,
      selected: winnerCandidate,
      alternatives: stepAlternatives,
      overlapTags,
      missingCapabilities: missingTags,
      locked: Boolean(winnerCandidate && lockedEvaluation),
    });
  }

  return {
    selected,
    alternatives,
    reasoning,
    missingCapabilities: Array.from(missingGlobal).sort(),
    steps,
  };
}
