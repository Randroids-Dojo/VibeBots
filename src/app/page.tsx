import { redirect } from "next/navigation";

/** The mine surface is the overworld hub; the landing page sends there. */
export default function HomePage() {
  redirect("/mine");
}
