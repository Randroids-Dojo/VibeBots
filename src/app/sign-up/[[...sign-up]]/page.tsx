import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { clerkConfigured } from "@/server/clerk-configured";

export default function SignUpPage() {
  if (!clerkConfigured()) {
    redirect("/mine?account=1");
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
