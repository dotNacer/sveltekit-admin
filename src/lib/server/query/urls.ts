/**
 * URL helpers shared by every piece of UI that builds a list-view URL:
 * the search box, the filter sidebar links, and pagination.
 *
 * Every list URL MUST go through `buildListUrl` — including pagination,
 * which today builds `?page=N` by hand. A hand-rolled URL bypasses the
 * "always drop `page` on filter change" invariant (docs/design §3.3, §7.1)
 * and risks parameter-order drift, which makes snapshots flaky.
 */

/**
 * Build a list-view URL from the current one, applying a patch of query
 * params. `null` in the patch removes that key. `page` is ALWAYS dropped
 * unless the patch explicitly sets it (pagination is the one caller that
 * does) — every other caller (search box, filter link) resets to page 1
 * implicitly by omitting `page` from its patch.
 *
 * Keys are sorted before serialization so the resulting URL is
 * deterministic — required for stable snapshot tests, and incidentally
 * nicer to read/bookmark.
 */
export function buildListUrl(
  currentUrl: URL,
  patch: Record<string, string | null>
): string {
  const params = new URLSearchParams(currentUrl.search);
  if (!('page' in patch)) {
    params.delete('page');
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }

  const sorted = new URLSearchParams();
  for (const key of [...params.keys()].sort()) {
    for (const value of params.getAll(key)) {
      sorted.append(key, value);
    }
  }

  const qs = sorted.toString();
  return qs ? `${currentUrl.pathname}?${qs}` : currentUrl.pathname;
}

/**
 * Hidden `<input>` params to re-emit inside a `<form method="GET">` so
 * submitting it doesn't wipe out every other active param — a bare GET
 * form REPLACES the whole query string with just its own fields (docs/design
 * §3.3). `exclude` lists the param(s) the form itself controls (e.g. `q`
 * for the search box, `f.published` for a single-field filter form);
 * `page` is always excluded too, since any new search/filter resets it.
 */
export function hiddenParams(
  currentUrl: URL,
  exclude: string[]
): { name: string; value: string }[] {
  const excluded = new Set([...exclude, 'page']);
  const out: { name: string; value: string }[] = [];
  for (const [key, value] of currentUrl.searchParams) {
    if (excluded.has(key)) continue;
    out.push({ name: key, value });
  }
  return out;
}
