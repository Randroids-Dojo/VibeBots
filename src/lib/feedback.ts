export const FEEDBACK_CATEGORIES = [
  "bug",
  "confusing",
  "balance",
  "controls",
  "positive",
  "other",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_CATEGORY_OPTIONS: Array<{
  value: FeedbackCategory;
  label: string;
}> = [
  { value: "bug", label: "Bug report" },
  { value: "confusing", label: "Confusing mechanic" },
  { value: "balance", label: "Balance feels off" },
  { value: "controls", label: "Controls problem" },
  { value: "positive", label: "Positive feedback" },
  { value: "other", label: "Other" },
];
