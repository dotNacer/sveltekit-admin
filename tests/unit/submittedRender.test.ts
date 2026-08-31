import { describe, it, expect, vi, afterEach } from "vitest";
import { createAdminHandler } from "../../src/lib/server/adapters/prisma/handler.js";
import {
  createPrismaMock,
  FULL_SCHEMA_PATH,
  RELATIONS_SCHEMA_PATH,
} from "../fixtures/prismaMock.js";
import { createEvent } from "../fixtures/events.js";

/**
 * Re-rendu d'un formulaire après un échec de mutation : ce qui a été tapé doit
 * survivre, et l'erreur doit désigner son champ quand elle en connaît un.
 */

function build(
  config: Record<string, unknown> = {},
  prisma = createPrismaMock({ user: [], post: [], category: [] }),
) {
  return {
    handler: createAdminHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      ...config,
    } as any),
    prisma,
  };
}

async function postRaw(
  handler: any,
  url: string,
  body: Record<string, string | string[]>,
): Promise<Response> {
  const { event, resolve } = createEvent({ url, body });
  return handler({ event, resolve } as any);
}

async function post(
  handler: any,
  url: string,
  body: Record<string, string | string[]>,
) {
  return (await postRaw(handler, url, body)).text();
}

afterEach(() => vi.restoreAllMocks());

describe("création en échec", () => {
  it("conserve les scalaires soumis dans le formulaire re-rendu", async () => {
    const { handler } = build();

    // `authorId: 999` sur une table user vide → AdminMutationError validation.
    const html = await post(handler, "/admin/post/new", {
      _action: "create",
      title: "Mon titre",
      content: "du texte",
      authorId: "999",
    });

    expect(html).toContain("Error: author: invalid value");
    expect(html).toContain('value="Mon titre"');
    expect(html).toContain(">du texte</textarea>");
  });
});

describe("édition en échec", () => {
  const USER = {
    id: 1,
    email: "a@b.c",
    password: "dbsecret",
    name: "Ancien nom",
    isActive: true,
    createdAt: new Date("2020-01-02T03:04:05Z"),
  };

  /** Un P2002 à l'update : rien de plus simple pour faire échouer un modèle sans FK. */
  function conflictingUpdate() {
    const prisma = createPrismaMock({ user: [USER], post: [], category: [] });
    prisma.user.update = () => {
      throw Object.assign(new Error("unique"), { code: "P2002" });
    };
    return prisma;
  }

  it("superpose les valeurs soumises sur la ligne relue en base", async () => {
    const { handler } = build({}, conflictingUpdate());

    const html = await post(handler, "/admin/user/1", {
      _action: "update",
      email: "a@b.c",
      name: "Nouveau nom",
    });

    expect(html).toContain("A record with these values already exists.");
    expect(html).toContain('value="Nouveau nom"');
    expect(html).not.toContain('value="Ancien nom"');
  });

  it("laisse décochée une case que le POST n’a pas envoyée", async () => {
    const { handler } = build({}, conflictingUpdate());

    // `isActive` est à `true` en base et absent du corps : c'est exactement ce
    // qu'envoie un navigateur quand l'utilisateur décoche la case.
    const html = await post(handler, "/admin/user/1", {
      _action: "update",
      email: "a@b.c",
    });

    expect(html).toContain('name="isActive"');
    expect(html).not.toMatch(/name="isActive"[^>]*checked/);
  });

  it("garde la valeur en base d’un champ readonly, que le POST peut ne pas renvoyer", async () => {
    const { handler } = build({}, conflictingUpdate());

    const html = await post(handler, "/admin/user/1", {
      _action: "update",
      email: "a@b.c",
    });

    // `id` / `createdAt` ne sont pas éditables : la ligne en base fait foi, et
    // les vider parce que le corps ne les portait pas serait une régression
    // d'affichage pure.
    expect(html).toContain('value="1"');
    expect(html).toContain('value="2020-01-02T03:04"');
  });

  it("ne renvoie pas dans le HTML un mot de passe qui vient d’être soumis", async () => {
    const { handler } = build({}, conflictingUpdate());

    const html = await post(handler, "/admin/user/1", {
      _action: "update",
      email: "a@b.c",
      password: "ce-que-je-viens-de-taper",
    });

    expect(html).not.toContain("ce-que-je-viens-de-taper");
  });
});

describe("relations en échec", () => {
  /** Post/Tag du corpus de relations : PK propres des deux côtés. */
  function conflictingPostCreate() {
    const prisma = createPrismaMock({
      user: [{ id: 1, email: "a@b.c" }],
      post: [],
      tag: [
        { id: 1, name: "alpha" },
        { id: 2, name: "beta" },
        { id: 3, name: "gamma" },
      ],
      label: [],
    });
    prisma.post.create = () => {
      throw Object.assign(new Error("unique"), { code: "P2002" });
    };
    return prisma;
  }

  const relationsHandler = () =>
    createAdminHandler({
      prisma: conflictingPostCreate(),
      prismaSchemaPath: RELATIONS_SCHEMA_PATH,
    } as any);

  it("réaffiche la cible de clé étrangère qui venait d’être choisie", async () => {
    const html = await post(relationsHandler(), "/admin/post/new", {
      _action: "create",
      title: "x",
      authorId: "1",
    });

    expect(html).toContain("A record with these values already exists.");
    // L’option est celle du select `authorId` : son libellé est l’email de l’utilisateur 1.
    expect(html).toMatch(/<option value="1" selected="">a@b\.c/);
  });

  it("recoche exactement les cases m2m qui venaient d’être cochées", async () => {
    const html = await post(relationsHandler(), "/admin/post/new", {
      _action: "create",
      title: "x",
      authorId: "1",
      __rel_present__tags: "1",
      __rel__tags: ["1", "3"],
    });

    expect(html).toMatch(/value="1"[^>]*class="ska-checkbox"[^>]*checked/);
    expect(html).toMatch(/value="3"[^>]*class="ska-checkbox"[^>]*checked/);
    expect(html).not.toMatch(/value="2"[^>]*class="ska-checkbox"[^>]*checked/);
  });
});

describe("association de l’erreur à son champ", () => {
  it("marque le champ désigné et rend le message à côté de lui", async () => {
    const prisma = createPrismaMock({ user: [], post: [], tag: [], label: [] });
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH,
    } as any);

    // `author: invalid value` : l'erreur nomme la relation, pas son scalaire.
    const html = await post(handler, "/admin/post/new", {
      _action: "create",
      title: "x",
      authorId: "999",
    });

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="authorId-error"');
    expect(html).toContain('id="authorId-error"');
    expect(html).toContain(">author: invalid value</p>");
  });

  it("marque le select quand l’erreur nomme le scalaire de la relation et non la relation", async () => {
    // Un refus de scope porte `authorId`, là où la boucle FK porte `author` :
    // les deux doivent atteindre le même widget.
    const prisma = createPrismaMock({
      user: [{ id: 1 }, { id: 2 }],
      post: [],
      tag: [],
      label: [],
    });
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH,
      models: { Post: { scope: () => ({ authorId: 1 }) } },
    } as any);

    const html = await post(handler, "/admin/post/new", {
      _action: "create",
      title: "x",
      authorId: "2",
    });

    expect(html).toContain('aria-describedby="authorId-error"');
    expect(html).toContain(
      "authorId: value is outside the authorization scope",
    );
  });

  it("marque un champ scalaire ordinaire", async () => {
    const prisma = createPrismaMock({
      user: [{ id: 1, email: "a@b.c" }],
      post: [],
      tag: [],
      label: [],
    });
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH,
      models: { Post: { scope: () => ({ title: "imposé" }) } },
    } as any);

    const html = await post(handler, "/admin/post/new", {
      _action: "create",
      title: "autre chose",
      authorId: "1",
    });

    expect(html).toContain('aria-describedby="title-error"');
    expect(html).toContain('id="title-error"');
  });

  it("ne marque aucun champ pour une erreur qui n’en désigne pas, et garde la bannière", async () => {
    const prisma = createPrismaMock({
      user: [{ id: 1, email: "a@b.c" }],
      post: [],
      tag: [],
      label: [],
    });
    prisma.post.create = () => {
      throw Object.assign(new Error("unique"), { code: "P2002" });
    };
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH,
    } as any);

    const html = await post(handler, "/admin/post/new", {
      _action: "create",
      title: "x",
      authorId: "1",
    });

    // Contrat historique de la bannière : inchangé pour un conflit d'unicité,
    // dont le champ fautif n'est pas connu (on classe par code, pas par méta).
    expect(html).toContain(
      '<div class="ska-alert ska-alert--error">Error: A record with these values already exists.</div>',
    );
    // Ciblé sur le markup : le CSS inline de la page définit `.ska-field__error`
    // et un sélecteur `[aria-invalid='true']` sur toutes les pages.
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).not.toContain('class="ska-field__error"');
  });
});

describe('statut de la réponse', () => {
  it('rend un formulaire refusé en 422 et non en 200', async () => {
    const prisma = createPrismaMock({ user: [], post: [], tag: [], label: [] });
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH
    } as any);

    const res = await postRaw(handler, '/admin/post/new', {
      _action: 'create',
      title: 'x',
      authorId: '999'
    });

    expect(res.status).toBe(422);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });

  it('laisse une page lue normalement en 200', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@b.c' }], post: [], tag: [], label: [] });
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH
    } as any);
    const { event, resolve } = createEvent({ url: '/admin/post/new' });

    expect((await handler({ event, resolve } as any)).status).toBe(200);
  });
});

