// One connection setup for the Edge Function and the local tests.
// Numbers come back as JS numbers (postgres.js returns numeric/bigint as
// strings by default, and every money rule here does arithmetic on them).

export function connect(postgres, url, opts = {}) {
  return postgres(url, {
    prepare: false,          // Supabase's pooler (transaction mode) cannot keep prepared statements
    max: opts.max || 3,
    idle_timeout: 20,
    types: {
      numeric: { to: 1700, from: [1700], serialize: (x) => String(x), parse: (x) => Number(x) },
      int8: { to: 20, from: [20], serialize: (x) => String(x), parse: (x) => Number(x) },
    },
    ...opts.extra,
  });
}
