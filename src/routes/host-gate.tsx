// Fallback from SPEC §2.1: the `<Routes>` imperative spike (see git history
// on this file) failed validation because it silently broke every
// `clientLoader` in the moved tree — only the file-routes/data-router
// convention (`HydratedRouter`) invokes `clientLoader`. AIK is now a normal
// file-routes subtree under the reserved `/__aik` prefix (`src/routes.ts`),
// and this module shrinks to the pure hostname check consumed by
// `routes/index-home.tsx`'s `clientLoader` to redirect `/` there.
const AIK_HOSTNAMES = ["aik.zadotec.com.br"];

export function isAikHostname(hostname: string): boolean {
  return AIK_HOSTNAMES.includes(hostname);
}
