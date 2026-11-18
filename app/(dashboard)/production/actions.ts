/**
 * Server actions for the production workspace.
 *
 * The implementations live in `app/(dashboard)/inventory/actions.ts`, because production and inventory are one
 * ledger: issuing material to a batch moves stock, recording output creates a lot, and closing a batch reads
 * the movements both wrote. Splitting the implementations across two files would mean two places deciding how
 * a quantity reaches the ledger.
 *
 * These re-exports give the production routes a stable import that does not depend on where inventory keeps
 * its own file, and let production actions appear in that workspace's own surface. Adding a production action
 * means adding it to the inventory file and re-exporting it here — the compiler enforces the second step.
 *
 * This module deliberately carries no `"use server"` directive. A `"use server"` file may only declare async
 * functions, and `export { x } from "..."` is a re-export rather than a declaration, so the build rejects it
 * with "the module has no exports at all". The actions themselves are already server actions in their own
 * file; this is only a documented alias.
 */

export {
  applyDeclaredInputsAction,
  closeBatchAction,
  createDeclaredInputAction,
  createPlanAction,
  createProcessAction,
  createStageAction,
  createYieldRuleAction,
  decidePlanAction,
  issueMaterialAction,
  logEntryAction,
  recordOutputAction,
  reserveMaterialAction,
  startBatchAction,
  submitPlanAction,
} from "@/app/(dashboard)/inventory/actions";
