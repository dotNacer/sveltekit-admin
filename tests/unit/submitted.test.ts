import { describe, it, expect } from "vitest";
import { readSubmittedForm } from "../../src/lib/server/submitted.js";

/** FormData depuis des paires, pour exprimer les clés répétées que `Record` ne peut pas porter. */
function formOf(pairs: Array<[string, string]>): FormData {
  const fd = new FormData();
  for (const [k, v] of pairs) fd.append(k, v);
  return fd;
}

describe("readSubmittedForm", () => {
  it("collecte les scalaires et écarte la clé de dispatch `_action`", () => {
    const submitted = readSubmittedForm(
      formOf([
        ["_action", "create"],
        ["title", "Mon titre"],
        ["content", ""],
      ]),
      new Set(),
    );

    expect(submitted.values).toEqual({ title: "Mon titre", content: "" });
  });

  it("n'écho pas un champ masqué par `hidden`", () => {
    const submitted = readSubmittedForm(
      formOf([
        ["_action", "update"],
        ["email", "a@b.c"],
        ["internalNote", "secret ops"],
      ]),
      new Set(["internalNote"]),
    );

    expect(submitted.values).toEqual({ email: "a@b.c" });
  });

  it("n'écho pas un champ que `isSensitiveFieldName` reconnaît", () => {
    const submitted = readSubmittedForm(
      formOf([
        ["email", "a@b.c"],
        ["password", "hunter2"],
        ["apiToken", "tok_live_1"],
        ["passwordHash", "x"],
        ["clientSecret", "y"],
      ]),
      new Set(),
    );

    expect(submitted.values).toEqual({ email: "a@b.c" });
  });

  it("regroupe les valeurs cochées de `__rel__<field>` quand le sentinelle est là", () => {
    const submitted = readSubmittedForm(
      formOf([
        ["_action", "update"],
        ["title", "t"],
        ["__rel_present__tags", "1"],
        ["__rel__tags", "3"],
        ["__rel__tags", "7"],
      ]),
      new Set(),
    );

    expect(submitted.m2m).toEqual({ tags: ["3", "7"] });
    // Ni le sentinelle ni les valeurs cochées ne polluent les scalaires.
    expect(submitted.values).toEqual({ title: "t" });
  });

  it("retient une relation vidée : sentinelle présent, aucune valeur cochée", () => {
    const submitted = readSubmittedForm(
      formOf([
        ["__rel_present__tags", "1"],
        ["__rel_present__labels", "1"],
        ["__rel__labels", "a"],
      ]),
      new Set(),
    );

    // `tags: []` et « widget absent » sont deux choses différentes : sans cette
    // entrée, un re-render recocherait ce que l'utilisateur vient de décocher.
    expect(submitted.m2m).toEqual({ tags: [], labels: ["a"] });
  });

  it("ignore des valeurs `__rel__` dont le sentinelle n'a pas été soumis", () => {
    const submitted = readSubmittedForm(
      formOf([["__rel__tags", "3"]]),
      new Set(),
    );

    expect(submitted.m2m).toEqual({});
  });

  it("n'écho pas une relation m2m masquée par `hidden`", () => {
    const submitted = readSubmittedForm(
      formOf([
        ["__rel_present__tags", "1"],
        ["__rel__tags", "3"],
      ]),
      new Set(["tags"]),
    );

    expect(submitted.m2m).toEqual({});
  });
});
