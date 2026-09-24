/**
 * Bootstraps an admin (after that, admins use the assignUser callable).
 * The user must have signed in once so their users doc exists.
 *
 *   Emulator:   npm run grant-admin -- --email you@example.com
 *   Production: npm run grant-admin -- --email you@example.com --project <id> --production
 */
import { parseArgs } from "node:util";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { initAdmin } from "./adminApp.js";

const { values: args } = parseArgs({
  options: {
    email: { type: "string" },
    project: { type: "string" },
    production: { type: "boolean", default: false },
  },
});
if (!args.email || (args.production && !args.project)) {
  console.error("Usage: grant-admin --email <email> [--project <id> --production]");
  process.exit(1);
}
const projectId = args.project ?? "demo-openverse";
initAdmin({ production: Boolean(args.production), projectId });

const user = await getAuth().getUserByEmail(args.email);
const ref = getFirestore().collection("users").doc(user.uid);
if (!(await ref.get()).exists) {
  console.error("No users doc yet: sign in from the app once (createOrSyncProfile), then rerun.");
  process.exit(1);
}
await ref.update({ role: "admin", teamId: null, updatedAt: FieldValue.serverTimestamp() });
await getAuth().setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), role: "admin", teamId: null });
console.log(`${args.email} (${user.uid}) is now admin on ${projectId}. They must refresh their ID token.`);
process.exit(0);
