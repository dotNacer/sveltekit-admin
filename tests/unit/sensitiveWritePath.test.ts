import { describe, it, expect, vi, afterEach } from "vitest";
import { createAdminHandler } from "../../src/lib/server/adapters/prisma/handler.js";
import {
  createPrismaMock,
  callsTo,
  FULL_SCHEMA_PATH,
  SEARCH_SCHEMA_PATH,
} from "../fixtures/prismaMock.js";
import { createEvent } from "../fixtures/events.js";

/**
 * Un champ `String` que `isSensitiveFieldName` reconnaît n'est pas une colonne
 * texte ordinaire : l'admin ne doit ni la relire, ni la réécrire sans qu'on le
 * lui demande.
 *
 * Asymétrie voulue entre les deux formulaires : à l'édition il existe une
 * valeur stockée, donc il y a quelque chose à fuiter et à écraser ; à la
 * création il n'y en a pas, et retirer le champ rendrait le modèle incréable
 * depuis l'admin.
 */

const USER = {
  id: 1,
  email: "a@b.c",
  password: "$2b$10$hash-stocke",
  name: "N",
};

function build(config: Record<string, unknown> = {}, rows = [USER]) {
  const prisma = createPrismaMock({ user: rows, post: [], category: [] });
  return {
    prisma,
    handler: createAdminHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      ...config,
    } as any),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("formulaire d’édition", () => {
  it("n’affiche pas du tout le champ sensible", async () => {
    const { handler } = build();
    const { event, resolve } = createEvent({ url: "/admin/user/1" });
    const html = await (await handler({ event, resolve } as any)).text();

    expect(html).not.toContain("$2b$10$hash-stocke");
    expect(html).not.toContain('name="password"');
  });

  it("laisse la colonne sensible intacte sur un update", async () => {
    const { prisma, handler } = build();
    const { event, resolve } = createEvent({
      url: "/admin/user/1",
      body: { _action: "update", email: "neuf@x.y" },
    });
    await handler({ event, resolve } as any);

    const data = (callsTo(prisma, "user", "update")[0].args as any).data;
    expect(data).not.toHaveProperty("password");
    expect(data).toMatchObject({ email: "neuf@x.y" });
  });

  it("ignore une colonne sensible qu’un POST forgé tente d’écrire", async () => {
    // Le champ n'est plus dans le formulaire : une valeur qui arrive quand même
    // ne vient pas de l'interface, et n'a aucune raison d'être écrite.
    const { prisma, handler } = build();
    const { event, resolve } = createEvent({
      url: "/admin/user/1",
      body: { _action: "update", email: "a@b.c", password: "injecte" },
    });
    await handler({ event, resolve } as any);

    expect(
      (callsTo(prisma, "user", "update")[0].args as any).data,
    ).not.toHaveProperty("password");
  });
});

describe("formulaire de création", () => {
  it("affiche le champ sensible, vide", async () => {
    const { handler } = build({}, []);
    const { event, resolve } = createEvent({ url: "/admin/user/new" });
    const html = await (await handler({ event, resolve } as any)).text();

    expect(html).toContain('name="password"');
    expect(html).toMatch(/id="password"[^>]*value=""/);
  });

  it("écrit la valeur fournie", async () => {
    const { prisma, handler } = build({}, []);
    const { event, resolve } = createEvent({
      url: "/admin/user/new",
      body: { _action: "create", email: "n@x.y", password: "pose-par-admin" },
    });
    await handler({ event, resolve } as any);

    expect(
      (callsTo(prisma, "user", "create")[0].args as any).data,
    ).toMatchObject({
      password: "pose-par-admin",
    });
  });

  it('refuse un vide sur une colonne sensible obligatoire, au lieu d’écrire ""', async () => {
    const { prisma, handler } = build({}, []);
    const { event, resolve } = createEvent({
      url: "/admin/user/new",
      body: { _action: "create", email: "n@x.y", password: "" },
    });
    const res = await handler({ event, resolve } as any);
    const html = await res.text();

    expect(res.status).toBe(422);
    expect(html).toContain("password is required");
    expect(html).toContain('aria-describedby="password-error"');
    expect(callsTo(prisma, "user", "create")).toHaveLength(0);
  });
});

describe("non-régression du scénario en deux temps", () => {
  it("un update refusé puis corrigé ne détruit pas le credential", async () => {
    // Le trou ouvert par #41 : le re-rendu d'erreur présentait le champ
    // sensible vide (à raison), et l'enregistrement suivant écrivait donc `''`
    // par-dessus le hash. La valeur n'était préservée avant #41 que par
    // l'aller-retour du hash affiché — une béquille, pas une garantie.
    const { prisma, handler } = build();
    prisma.user.update = vi
      .fn()
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("u"), { code: "P2002" });
      })
      .mockImplementation((args: any) => ({ ...USER, ...args.data }));

    // Temps 1 : l'email est déjà pris, le formulaire revient en erreur.
    const first = createEvent({
      url: "/admin/user/1",
      body: { _action: "update", email: "occupe@x.y" },
    });
    const html = await (await handler(first as any)).text();
    expect(html).not.toContain('name="password"');

    // Temps 2 : l'admin corrige et resoumet ce que le formulaire lui présente.
    const second = createEvent({
      url: "/admin/user/1",
      body: { _action: "update", email: "libre@x.y" },
    });
    await handler(second as any);

    const data = (prisma.user.update as any).mock.calls.at(-1)[0].data;
    expect(data).not.toHaveProperty("password");
    expect(data).toMatchObject({ email: "libre@x.y" });
  });
});

describe("colonne sensible optionnelle", () => {
  // `Article.apiToken` / `Article.authorHash` du corpus de recherche : String?,
  // donc sensibles mais pas obligatoires.
  const articleHandler = (prisma: any) =>
    createAdminHandler({ prisma, prismaSchemaPath: SEARCH_SCHEMA_PATH } as any);

  it("vide à la création : la clé est omise, jamais écrite comme chaîne vide", async () => {
    const prisma = createPrismaMock({ article: [] });
    const { event, resolve } = createEvent({
      url: "/admin/article/new",
      body: {
        _action: "create",
        title: "t",
        slug: "s",
        apiToken: "",
        authorHash: "",
      },
    });
    await articleHandler(prisma)({ event, resolve } as any);

    const data = (callsTo(prisma, "article", "create")[0].args as any).data;
    // `''` serait indistinguable d'un secret réellement égal à la chaîne vide.
    expect(data).not.toHaveProperty("apiToken");
    expect(data).not.toHaveProperty("authorHash");
    expect(data).toMatchObject({ title: "t", slug: "s" });
  });

  it("vide à la création : accepté, aucun refus puisque la colonne est optionnelle", async () => {
    const prisma = createPrismaMock({ article: [] });
    const { event, resolve } = createEvent({
      url: "/admin/article/new",
      body: { _action: "create", title: "t", slug: "s", apiToken: "" },
    });
    const res = await articleHandler(prisma)({ event, resolve } as any);

    expect(res.status).toBe(303);
  });
});
