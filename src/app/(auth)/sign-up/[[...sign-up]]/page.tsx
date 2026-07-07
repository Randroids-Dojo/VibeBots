import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { ACCOUNT_DIALOG_PATH } from "@/lib/account-env-rules.mjs";
import { clerkConfigured } from "@/server/clerk-configured";

export default function SignUpPage() {
  if (!clerkConfigured()) {
    redirect(ACCOUNT_DIALOG_PATH);
    return;
  }

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <SignUp />
    </div>
  );
}
