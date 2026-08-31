---
"sveltekit-admin": minor
---

**The dashboard is composable from configuration.** `dashboard.widgets` takes an ordered array — the array order is the on-screen order — so the home page can show the models that matter, grouped under section titles, instead of one flat grid of everything.

```ts
dashboard: {
  title: 'Console',
  widgets: [
    { type: 'stats' },
    { type: 'models', title: 'Content', models: ['Post', 'Comment'] },
    { type: 'models', title: 'Accounts', models: ['User'] }
  ]
}
```

Two widget types ship here: `stats` (the two global cards) and `models` (a grid, optionally restricted and titled). Omitting `dashboard` keeps the previous page; `widgets: []` renders an empty one, which is a valid choice.

**The configuration is validated when the handler is created, not when the page renders.** An unknown widget type, or a widget pointing at a model that does not exist or sits in `exclude`, throws at boot — the same policy as `listFilter` and plugins. A model in `exclude` therefore cannot be brought back into view through a widget.

Counts are scoped exactly as before, and a model appearing in several widgets is counted once per request.
