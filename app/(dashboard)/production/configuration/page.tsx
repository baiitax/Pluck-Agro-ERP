import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ClipboardList, FlaskConical, GitBranch, Layers, Scale } from "lucide-react";

import {
  createDeclaredInputAction,
  createProcessAction,
  createStageAction,
  createYieldRuleAction,
} from "@/app/(dashboard)/production/actions";
import { ActionForm } from "@/components/shared/action-form";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { labelForInventoryStatus } from "@/lib/inventory/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getProductionConfiguration } from "@/services/inventory/dashboard";
import { listProducts, listUnits } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "Production configuration" };
export const dynamic = "force-dynamic";

const number = (value: number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

/**
 * Production configuration: stages, routing, declared inputs and yield rules.
 *
 * Everything on this page is a statement the company makes about its own process. None of it is seeded, and
 * none of it is inferred from history. Two consequences are spelled out in the page copy rather than left to
 * be discovered: a product with no declared inputs produces plans with no requirement lines, and a product
 * with no yield rule makes every batch close require a stated reason.
 *
 * Routing rows are descriptive only — they never create a material requirement.
 */
export default async function ProductionConfigurationPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("production.product.view")) {
    return <PermissionGuard permission="production.product.view" />;
  }

  const canManage = principal.permissions.has("production.product.manage");
  const [configuration, products, units] = await Promise.all([
    getProductionConfiguration(),
    canManage ? listProducts() : Promise.resolve([]),
    canManage ? listUnits() : Promise.resolve([]),
  ]);

  const { stages, processes, inputs, yieldRules } = configuration;
  const today = new Date().toISOString().slice(0, 10);
  const nothingConfigured =
    stages.length === 0 && processes.length === 0 && inputs.length === 0 && yieldRules.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Production configuration"
        description="What the factory says it does — stages, routing, declared inputs and yield bands."
        breadcrumbs={[
          { label: "Production", href: "/production" },
          { label: "Configuration" },
        ]}
        actions={
          <Link
            href="/production"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <ArrowLeft aria-hidden /> Production overview
          </Link>
        }
      />

      <Alert tone="info" title="This page is deliberately empty until Pluck Agro fills it in">
        <p>
          No stage, route, declared input or yield band ships with the system. They describe a real process, and
          only the company can state it. The consequences of leaving a section empty are listed with each
          section, so an empty table is never mistaken for a broken one.
        </p>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Stages", value: stages.length, hint: "Named processing steps" },
          { label: "Routing steps", value: processes.length, hint: "Product → stage order" },
          { label: "Declared inputs", value: inputs.length, hint: "Per stated basis of output" },
          { label: "Yield rules", value: yieldRules.length, hint: "Declared acceptance bands" },
        ].map((metric) => (
          <Card key={metric.label} className="p-4">
            <p className="text-xs font-medium text-ink-muted">{metric.label}</p>
            <p className="mt-1.5 text-xl font-semibold tracking-tight text-ink tabular-nums">{metric.value}</p>
            <p className="mt-1 text-[0.6875rem] text-ink-subtle">{metric.hint}</p>
          </Card>
        ))}
      </div>

      {nothingConfigured && !canManage ? (
        <EmptyState
          icon={Layers}
          title="Nothing has been configured yet"
          description="Someone with the configure permission needs to describe the factory process before plans can carry requirements."
        />
      ) : null}

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Add a stage</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm action={createStageAction} submitLabel="Add stage" successMessage="Stage added.">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="stage-code">Code</Label>
                    <Input id="stage-code" name="code" placeholder="CLEANING" required className="uppercase" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="stage-name">Name</Label>
                    <Input id="stage-name" name="name" placeholder="Cleaning" required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="stage-sequence">Sequence</Label>
                    <Input id="stage-sequence" name="sequence" inputMode="numeric" defaultValue="10" required className="h-9" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="stage-description">Description</Label>
                    <Textarea id="stage-description" name="description" rows={2} className="text-xs" />
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  Codes are 2–16 characters, uppercase, starting with a letter. Sequence orders the stages in
                  routing tables and reports.
                </p>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add a routing step</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm
                action={createProcessAction}
                submitLabel="Add routing step"
                successMessage="Routing step added."
                disabled={stages.length === 0 || products.length === 0}
                disabledHint={
                  stages.length === 0
                    ? "Add a stage first — a route is a product passing through a stage."
                    : products.length === 0
                      ? "No active product is available to route."
                      : undefined
                }
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="route-product">Product</Label>
                    <select
                      id="route-product"
                      name="productId"
                      required
                      className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs"
                    >
                      <option value="">Select a product…</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="route-stage">Stage</Label>
                    <select
                      id="route-stage"
                      name="stageId"
                      required
                      className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs"
                    >
                      <option value="">Select a stage…</option>
                      {stages.map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.code} · {stage.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="route-sequence">Sequence</Label>
                    <Input id="route-sequence" name="sequence" inputMode="numeric" defaultValue="10" required className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="route-hours">Expected hours</Label>
                    <Input id="route-hours" name="expectedDurationHours" inputMode="decimal" className="h-9" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="route-instructions">Instructions</Label>
                    <Textarea id="route-instructions" name="instructions" rows={2} className="text-xs" />
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  A product appears once per stage. Routing is descriptive: it never adds material requirements
                  to a plan — declared inputs below do that.
                </p>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Declare an input</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm
                action={createDeclaredInputAction}
                submitLabel="Declare input"
                successMessage="Declared input saved."
                disabled={products.length < 2 || units.length === 0}
                disabledHint={
                  products.length < 2
                    ? "Declaring an input needs an output product and at least one other product to consume."
                    : units.length === 0
                      ? "No unit of measure is available."
                      : undefined
                }
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="input-product">Output product</Label>
                    <select
                      id="input-product"
                      name="productId"
                      required
                      className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs"
                    >
                      <option value="">Select the product produced…</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="input-input">Input product</Label>
                    <select
                      id="input-input"
                      name="inputProductId"
                      required
                      className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs"
                    >
                      <option value="">Select the product consumed…</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="input-quantity">Quantity</Label>
                    <Input id="input-quantity" name="quantity" inputMode="decimal" required className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="input-basis">Per basis of output</Label>
                    <Input id="input-basis" name="basisQuantity" inputMode="decimal" defaultValue="1" required className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="input-unit">Unit</Label>
                    <select
                      id="input-unit"
                      name="unitId"
                      required
                      className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs"
                    >
                      <option value="">Select a unit…</option>
                      {units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end gap-2 pb-1">
                    <input id="input-optional" name="isOptional" type="checkbox" className="size-4 rounded border-border" />
                    <Label htmlFor="input-optional" className="text-xs">
                      Optional input
                    </Label>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="input-notes">Notes</Label>
                    <Input id="input-notes" name="notes" className="h-8 text-xs" />
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  Quantity is stated against the basis, for example 12 units of input per 100 units of output.
                  Plans scale this arithmetically; the system does not derive a figure nobody stated.
                </p>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Declare a yield band</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm
                action={createYieldRuleAction}
                submitLabel="Declare band"
                successMessage="Yield rule saved."
                disabled={products.length === 0}
                disabledHint={products.length === 0 ? "No active product is available." : undefined}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="rule-product">Product</Label>
                    <select
                      id="rule-product"
                      name="productId"
                      required
                      className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs"
                    >
                      <option value="">Select a product…</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rule-basis">Basis</Label>
                    <Select id="rule-basis" name="basis" defaultValue="output_over_input">
                      <option value="output_over_input">Output ÷ input (computed)</option>
                      <option value="stated">Stated by the company</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rule-from">Effective from</Label>
                    <Input id="rule-from" name="effectiveFrom" type="date" defaultValue={today} required className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rule-min">Minimum %</Label>
                    <Input id="rule-min" name="minPercent" inputMode="decimal" className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rule-max">Maximum %</Label>
                    <Input id="rule-max" name="maxPercent" inputMode="decimal" className="h-9" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="rule-notes">Notes</Label>
                    <Input id="rule-notes" name="notes" className="h-8 text-xs" />
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  Leave the percentages blank to record that no tolerance has been agreed. With no band, every
                  batch close requires a stated reason — the system will not certify a yield as normal.
                </p>
              </ActionForm>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Stages</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {stages.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No stages declared"
              description="Plans and batches still work; the process description and routing tables stay empty."
            />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Sequence</TH>
                    <TH>Code</TH>
                    <TH>Name</TH>
                    <TH>Description</TH>
                    <TH>State</TH>
                  </TR>
                </THead>
                <TBody>
                  {stages.map((stage) => (
                    <TR key={stage.id}>
                      <TD className="tabular-nums">{stage.sequence}</TD>
                      <TD className="font-mono text-xs">{stage.code}</TD>
                      <TD>{stage.name}</TD>
                      <TD className="text-xs">{stage.description ?? "—"}</TD>
                      <TD>
                        <Badge tone={stage.is_active ? "success" : "neutral"}>
                          {stage.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Routing</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {processes.length === 0 ? (
              <EmptyState
                icon={GitBranch}
                title="No routing declared"
                description="Batch execution does not depend on routing, so an empty route does not block anything."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Product</TH>
                      <TH>Stage</TH>
                      <TH className="text-right">Sequence</TH>
                      <TH className="text-right">Hours</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {processes.map((process) => (
                      <TR key={process.id}>
                        <TD>{process.productName}</TD>
                        <TD>{process.stageName}</TD>
                        <TD className="text-right tabular-nums">{process.sequence}</TD>
                        <TD className="text-right tabular-nums">
                          {process.expectedDurationHours === null ? "—" : number(process.expectedDurationHours)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Declared inputs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {inputs.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No inputs declared"
                description="Plans created for any product will have no requirement lines until an input is declared here."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Output product</TH>
                      <TH>Input product</TH>
                      <TH className="text-right">Quantity</TH>
                      <TH className="text-right">Per basis</TH>
                      <TH>Kind</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {inputs.map((input) => (
                      <TR key={input.id}>
                        <TD>{input.productName}</TD>
                        <TD>{input.inputProductName}</TD>
                        <TD className="text-right tabular-nums">
                          {number(input.quantity)} {input.unitCode}
                        </TD>
                        <TD className="text-right tabular-nums">{number(input.basisQuantity)}</TD>
                        <TD>
                          <Badge tone={input.isOptional ? "neutral" : "brand"}>
                            {input.isOptional ? "Optional" : "Required"}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Yield rules</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {yieldRules.length === 0 ? (
            <EmptyState
              icon={Scale}
              title="No yield band declared"
              description="Every batch close for every product will require a written reason until a band is agreed."
            />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH>Basis</TH>
                    <TH className="text-right">Band</TH>
                    <TH>Effective</TH>
                    <TH>State</TH>
                  </TR>
                </THead>
                <TBody>
                  {yieldRules.map((rule) => (
                    <TR key={rule.id}>
                      <TD>{rule.productName}</TD>
                      <TD className="text-xs">{labelForInventoryStatus(rule.basis)}</TD>
                      <TD className="text-right tabular-nums">
                        {rule.minPercent === null && rule.maxPercent === null
                          ? "No tolerance stated"
                          : `${rule.minPercent === null ? "—" : number(rule.minPercent)}% – ${
                              rule.maxPercent === null ? "—" : number(rule.maxPercent)
                            }%`}
                      </TD>
                      <TD className="text-xs">
                        {formatDate(rule.effectiveFrom)}
                        {rule.effectiveTo ? ` → ${formatDate(rule.effectiveTo)}` : " → open"}
                      </TD>
                      <TD>
                        <Badge tone={rule.isActive ? "success" : "neutral"}>
                          {rule.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Why these gaps are stated, not filled</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-ink-muted">
          <p className="flex items-start gap-2">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" aria-hidden />
            Stage names, declared inputs and yield bands describe a physical process. Filling them with plausible
            examples would put invented figures behind a real batch close, so the tables start empty.
          </p>
          <p>
            Versioning: yield rules carry an effective period and are never overwritten, so a batch closed under
            an old band still reads against the band that was in force at the time.
          </p>
          <p>
            Still to be decided by Pluck Agro before these tables can be populated meaningfully: the yield
            formula and band per product, grading limits, and the process-loss percentages per stage.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
