// The issue-code list lives in account-env-rules.mjs (F-067), the single
// rules module shared with scripts/check-account-env.mjs. This wrapper
// derives the TypeScript types and the status contract from it.
import { ACCOUNT_PROVIDER_ISSUES } from "./account-env-rules.mjs";

export { ACCOUNT_PROVIDER_ISSUES };

export type AccountProviderIssue = (typeof ACCOUNT_PROVIDER_ISSUES)[number];

export type AccountProviderStatus = {
  provider: "clerk";
} & (
  | { ready: true; reason: null; issues: [] }
  | {
      ready: false;
      reason: AccountProviderIssue | null;
      issues: AccountProviderIssue[];
    }
);

export function isAccountProviderIssue(
  value: string,
): value is AccountProviderIssue {
  return ACCOUNT_PROVIDER_ISSUES.includes(value as AccountProviderIssue);
}
