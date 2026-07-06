import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { clerkConfigured } from "@/server/clerk-configured";

export default function SignInPage() {
  if (!clerkConfigured()) {
    redirect("/mine?account=1");
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
