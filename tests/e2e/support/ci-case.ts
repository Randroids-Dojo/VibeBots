export const CI_CAPABILITY_TAGS = [
  "@functional",
  "@render",
  "@visual",
  "@soak",
] as const;

export const CI_POLICY_TAGS = ["@critical", "@preview", "@serial"] as const;

export type CiCapabilityTag = (typeof CI_CAPABILITY_TAGS)[number];
export type CiPolicyTag = (typeof CI_POLICY_TAGS)[number];

export function ciCase(
  caseId: string,
  capability: CiCapabilityTag,
  policyTags: readonly CiPolicyTag[] = [],
) {
  return {
    tag: [capability, ...policyTags],
    annotation: [{ type: "case-id", description: caseId }],
  };
}
