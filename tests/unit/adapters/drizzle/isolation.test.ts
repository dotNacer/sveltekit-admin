import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/lib/server/adapters/prisma/index.js", () => {
  throw new Error("prisma adapter index loaded");
});
vi.mock("../../../../src/lib/server/adapters/prisma/handler.js", () => {
  throw new Error("prisma handler loaded");
});
vi.mock("../../../../src/lib/server/adapters/prisma/dataAdapter.js", () => {
  throw new Error("prisma dataAdapter loaded");
});
vi.mock("../../../../src/lib/server/adapters/prisma/introspector.js", () => {
  throw new Error("prisma introspector loaded");
});
vi.mock("../../../../src/lib/server/adapters/prisma/filterCompiler.js", () => {
  throw new Error("prisma filterCompiler loaded");
});

describe("isolation du sous-chemin drizzle", () => {
  it("importe le sous-chemin sans évaluer adapters/prisma", async () => {
    const mod = await import("../../../../src/lib/server/adapters/drizzle/index.js");
    expect(typeof mod.createAdminHandler).toBe("function");
    expect(typeof mod.createDrizzleAdapter).toBe("function");
    expect(typeof mod.defaultAdminCheck).toBe("function");
  });
});
