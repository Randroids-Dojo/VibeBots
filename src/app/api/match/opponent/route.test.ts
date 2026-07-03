import { beforeEach, describe, expect, it, vi } from "vitest";
import { storageConfigured } from "@/server/db";
import { CPU_BRAWLER_DESIGN } from "@/sim/design";
import { GET } from "./route";

const sqlMock = vi.fn(async () => [] as unknown[]);

vi.mock("@/server/db", () => ({
  storageConfigured: vi.fn(() => true),
  db: vi.fn(async () => sqlMock),
}));

vi.mock("@/server/player", () => ({
  getOrCreatePlayerId: vi.fn(async () => "player-1"),
}));

const mockedStorageConfigured = vi.mocked(storageConfigured);

describe("GET /api/match/opponent", () => {
  beforeEach(() => {
    mockedStorageConfigured.mockReturnValue(true);
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
  });

  it("returns 503 without storage", async () => {
    mockedStorageConfigured.mockReturnValue(false);
    expect((await GET()).status).toBe(503);
  });

  it("returns 404 when no rival design exists", async () => {
    expect((await GET()).status).toBe(404);
  });

  it("returns the first valid rival design and skips broken rows", async () => {
    sqlMock.mockResolvedValue([
      { design: { name: "corrupt" }, updated_at: "2026-07-03" },
      { design: CPU_BRAWLER_DESIGN, updated_at: "2026-07-02" },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { design: { name: string } };
    expect(body.design.name).toBe(CPU_BRAWLER_DESIGN.name);
  });
});
