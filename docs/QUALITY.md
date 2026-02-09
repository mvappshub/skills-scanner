# Quality Metrics (RC1/RC2)

This project logs workflow quality metrics to browser console as:

```text
[quality] { ... }
```

## Metrics

1. `% steps assembled without missing tags`
   - Field: `assembledCoveragePct`
   - Formula: `(steps with missingCapabilities.length === 0) / total steps * 100`

2. `# unknown tags after normalization`
   - Field: `unknownTagsAfterNormalization`
   - Source: workflow plan normalization warnings with `reason === "unknown_tag"`

3. `# dropped artifacts (missing evidence)`
   - Field: `droppedArtifactsNoEvidence`
   - Source: semantics invalid tag issues with `reason === "artifact_evidence_missing"`

4. `time-to-plan` and `time-to-assemble`
   - Fields: `timeToPlanMs`, `timeToAssembleMs`
   - Units: milliseconds

5. `# danger steps and confirmation gates`
   - Fields: `dangerSteps`, `dangerConfirmations`
   - `dangerSteps`: assembled steps where selected skill has `riskLevel === "danger"`
   - `dangerConfirmations`: total count of "I understand / Continue" actions

## Where it is emitted

- Plan generation event:
  - `event: "plan_generated"`
- Assemble event:
  - `event: "assemble"`
- Danger gate confirmation event:
  - `event: "danger_confirmation"`

Implementation is in `components/WorkflowPanel.tsx`.
