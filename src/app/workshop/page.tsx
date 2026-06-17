import { BackToMine } from "@/components/back-to-mine";
import { PartsShop } from "@/components/parts-shop";
import { WorkshopPanel } from "@/components/workshop-panel";

export default function WorkshopPage() {
  return (
    <main>
      <BackToMine />
      <WorkshopPanel />
      <PartsShop />
    </main>
  );
}
