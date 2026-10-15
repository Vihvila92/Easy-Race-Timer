/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-stays-pure',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: '^packages/(people|i18n|storage|sync|sports|timing-sources|race-formats|exporters|server|web)/' },
    },
    {
      name: 'i18n-stays-pure',
      severity: 'error',
      from: { path: '^packages/i18n/' },
      to: { path: '^packages/(core|people|storage|sync|sports|timing-sources|race-formats|exporters|server|web)/' },
    },
    {
      name: 'domain-does-not-reach-up',
      severity: 'error',
      from: { path: '^packages/(people|storage|sync)/' },
      to: { path: '^packages/(i18n|sports|timing-sources|race-formats|exporters|server|web)/' },
    },
    {
      name: 'extensions-stay-low',
      severity: 'error',
      from: { path: '^packages/(sports|timing-sources|race-formats|exporters)/' },
      to: { path: '^packages/(people|storage|sync|server|web)/' },
    },
    {
      name: 'server-does-not-import-web',
      severity: 'error',
      from: { path: '^packages/server/' },
      to: { path: '^packages/web/' },
    },
    {
      name: 'web-does-not-import-server',
      severity: 'error',
      from: { path: '^packages/web/' },
      to: { path: '^packages/(server|storage)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default'],
    },
  },
}
