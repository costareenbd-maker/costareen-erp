// One connection setup for the Edge Function and the local tests.
// Numbers come back as JS numbers (postgres.js returns numeric/bigint as
// strings by default, and every money rule here does arithmetic on them).

export function connect(postgres, url, opts = {}) {
  return postgres(url, {
    prepare: false,          // Supabase's pooler (transaction mode) cannot keep prepared statements
    // Few connections, let go fast: every running copy of the server holds its own, and the
    // pooler refuses everyone past its limit (EMAXCONN, 200) when many copies run at once.
    max: opts.max || 2,
    idle_timeout: 5,
    connect_timeout: 10,
    types: {
      numeric: { to: 1700, from: [1700], serialize: (x) => String(x), parse: (x) => Number(x) },
      int8: { to: 20, from: [20], serialize: (x) => String(x), parse: (x) => Number(x) },
    },
    ...opts.extra,
  });
}
