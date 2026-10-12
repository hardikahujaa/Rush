/**
 * Regenerates src/components/home/stack-icons.ts.
 *
 *   node scripts/extract-stack-icons.mjs
 *
 * Pulls just the named brand marks the "Engineered for Scale" stack marquee
 * uses out of `simple-icons`'s ~5MB root module into a ~2KB static file - see
 * the long comment at the top of the generated file for why. `simple-icons`
 * stays a devDependency; nothing it exports reaches the client bundle.
 *
 * To add or change a logo: edit the `ICONS` map below, add/adjust the import,
 * then rerun this script.
 */
import { siNextdotjs, siPostgresql, siRedis, siResend, siStripe } from "simple-icons";
import fs from "node:fs";

const ICONS = {
  nextdotjs: siNextdotjs,
  postgresql: siPostgresql,
  redis: siRedis,
  resend: siResend,
  stripe: siStripe,
};

const entries = Object.entries(ICONS)
  .map(([key, icon]) => `  ${key}: { title: ${JSON.stringify(icon.title)}, path: ${JSON.stringify(icon.path)} },`)
  .join("\n");

const out = `/**
 * Five brand mark paths, extracted once from \`simple-icons\` by
 * \`scripts/extract-stack-icons.mjs\` rather than imported at runtime.
 *
 * \`simple-icons\`'s root module is a single ~5MB ESM file of ~3,200 named
 * \`const\` exports - tree-shaking THAT down to the 5 this page needs relies on
 * Turbopack correctly eliminating the other ~3,195, which is plausible but
 * untested, not measured. Lifting just the \`{title, path}\` pairs this file
 * actually uses into a static 2KB file removes the question entirely: nothing
 * from \`simple-icons\` is in the client bundle, regardless of how any future
 * bundler treats it. \`simple-icons\` stays a devDependency, used only to
 * regenerate this file if a stack logo is ever added or changed.
 *
 * Do not hand-edit - rerun \`node scripts/extract-stack-icons.mjs\`.
 */
export const STACK_ICONS = {
${entries}
} as const;
`;

fs.writeFileSync(new URL("../src/components/home/stack-icons.ts", import.meta.url), out);
console.log("wrote src/components/home/stack-icons.ts");
