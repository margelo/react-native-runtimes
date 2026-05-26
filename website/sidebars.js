// @ts-check

module.exports = {
  runtimeDocs: [
    'intro',
    'installation',
    {
      type: 'category',
      label: 'Threaded Runtime',
      items: [
        'threaded-runtime/render-components',
        'threaded-runtime/pass-props',
        'threaded-runtime/prewarming',
        'threaded-runtime/background-work',
        'threaded-runtime/scheduling-functions',
        'threaded-runtime/business-logic-executor',
      ],
    },
    {
      type: 'category',
      label: 'Shared State',
      items: ['shared-state/multi-runtime-zustand'],
    },
    'examples',
  ],
};
