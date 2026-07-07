import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { ACCOUNT_DIALOG_PATH } from "@/lib/account-env-rules.mjs";
import { clerkConfigured } from "@/server/clerk-configured";

export default function SignInPage() {
  if (!clerkConfigured()) {
    redirect(ACCOUNT_DIALOG_PATH);
    return;
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#080b12",
        padding: 16,
      }}
    >
      <SignIn />
    </main>
  );
}
