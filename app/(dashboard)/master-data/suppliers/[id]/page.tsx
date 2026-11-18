import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, History, Landmark, MapPin, Package, ShieldCheck, Users } from "lucide-react";

import { ConfirmActionButton } from "@/components/master-data/confirm-action-button";
import { DetailList } from "@/components/master-data/detail-list";
import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { SectionTabs } from "@/components/master-data/section-tabs";
import { StatusTransitionDialog } from "@/components/master-data/status-transition-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import {
  ADDRESS_TYPES,
  MASTER_STATUS_LABELS,
  labelFor,
  masterStatusTone,
} from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { cn } from "@/lib/utils";
import {
  removeSupplierAddressAction,
  removeSupplierBankAccountAction,
  removeSupplierContactAction,
  saveSupplierAddressAction,
  saveSupplierBankAccountAction,
  saveSupplierContactAction,
  setSupplierProductCategoriesAction,
  verifySupplierAction,
  verifySupplierBankAccountAction,
  changeSupplierStatusAction,
} from "@/app/(dashboard)/master-data/actions";
import { getSupplierCategories } from "@/services/master-data/categories";
import { getAvailableTransitions } from "@/services/master-data/status-transitions";
import { getSupplierBankAccounts } from "@/services/master-data/supplier-banking";
import { getSupplier } from "@/services/master-data/suppliers";

export const metadata: Metadata = { title: "Supplier" };
export const dynamic = "force-dynamic";

const TAB_KEYS = ["overview", "contacts", "addresses", "procurement", "banking", "documents", "history"] as const;

export default async function SupplierProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab = TAB_KEYS.includes((requestedTab ?? "overview") as (typeof TAB_KEYS)[number]) ? (requestedTab ?? "overview") : "overview";

  const { allowed, principal } = await guardMasterDataPage("master_data.suppliers.view");
  if (!allowed) return <PermissionGuard permission="master_data.suppliers.view" />;

  const detail = await getSupplier(id);
  if (!detail) notFound();

  const { supplier } = detail;
  const canManage = principal.permissions.has("master_data.suppliers.update");
  const canVerify = principal.permissions.has("master_data.suppliers.verify");
  const canBank = principal.permissions.has("master_data.supplier_banking.view");
  const canManageBank = principal.permissions.has("master_data.supplier_banking.manage");

  const [transitions, bankAccounts, categories] = await Promise.all([
    getAvailableTransitions("supplier", supplier.status),
    canBank ? getSupplierBankAccounts(supplier.id) : Promise.resolve([]),
    getSupplierCategories(),
  ]);

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "contacts", label: "Contacts", count: detail.contacts.length },
    { key: "addresses", label: "Addresses", count: detail.addresses.length },
    { key: "procurement", label: "Approved supply", count: detail.productCategories.length },
    ...(canBank ? [{ key: "banking", label: "Banking", count: bankAccounts.length }] : []),
    { key: "documents", label: "Documents", count: detail.documents.length },
    { key: "history", label: "History", count: detail.history.length },
  ];

  return (
    <div>
      <PageHeader
        title={supplier.legal_name}
        description={`Supplier ${supplier.reference}${supplier.trading_name ? ` · trading as ${supplier.trading_name}` : ""}`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Suppliers", href: "/master-data/suppliers" },
          { label: supplier.reference },
        ]}
        badge={
          <div className="flex items-center gap-1.5">
            <Badge tone={masterStatusTone(supplier.status)} dot>
              {MASTER_STATUS_LABELS[supplier.status] ?? supplier.status}
            </Badge>
            <Badge tone={supplier.verification_status === "verified" ? "success" : "neutral"}>
              {labelFor(supplier.verification_status)}
            </Badge>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canVerify ? (
              <RecordFormDialog
                title="Record verification outcome"
                description="Verification records that documents were checked. It does not activate the supplier — activation is a separate permission and a separate transition."
                triggerLabel="Verify"
                trigger="edit"
                action={verifySupplierAction}
                hidden={{ id: supplier.id }}
                fields={[
                  {
                    name: "verificationStatus",
                    label: "Outcome",
                    type: "select",
                    required: true,
                    options: [
                      { value: "pending", label: "Pending" },
                      { value: "verified", label: "Verified" },
                      { value: "failed", label: "Failed" },
                      { value: "unverified", label: "Back to unverified" },
                    ],
                  },
                  { name: "verifiedOn", label: "Verification date", type: "date" },
                  { name: "notes", label: "Notes", type: "textarea", wide: true },
                ]}
                values={{ verificationStatus: supplier.verification_status, verifiedOn: supplier.last_verification_date }}
              />
            ) : null}
            {canManage ? (
              <Link href={`/master-data/suppliers/${supplier.id}/edit`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
                Edit
              </Link>
            ) : null}
            {transitions.length > 0 ? (
              <StatusTransitionDialog
                id={supplier.id}
                entityLabel="Supplier"
                currentStatus={MASTER_STATUS_LABELS[supplier.status] ?? supplier.status}
                options={transitions}
                action={changeSupplierStatusAction}
              />
            ) : null}
          </div>
        }
      />

      <SectionTabs base={`/master-data/suppliers/${supplier.id}`} active={tab} tabs={tabs} />

      <div className="mt-4 space-y-4">
        {tab === "overview" ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-2">
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Building2 className="size-4 text-ink-subtle" aria-hidden /> Identity &amp; registration
              </h2>
              <DetailList
                items={[
                  { label: "Reference", value: <span className="font-mono">{supplier.reference}</span> },
                  { label: "Legal name", value: supplier.legal_name },
                  { label: "Trading name", value: supplier.trading_name ?? "—" },
                  { label: "Supplier type", value: labelFor(supplier.supplier_type) },
                  { label: "Primary category", value: detail.category?.name ?? "—" },
                  { label: "Country of registration", value: supplier.registration_country ?? "—" },
                  { label: "Business registration no.", value: supplier.registration_number ?? "—" },
                  { label: "Tax identification no.", value: supplier.tax_identification_number ?? "—" },
                  { label: "Preferred currency", value: supplier.preferred_currency_code ?? "—" },
                  { label: "Phone", value: supplier.phone ?? "—" },
                  { label: "Email", value: supplier.email ?? "—" },
                  { label: "Website", value: supplier.website ?? "—" },
                  { label: "Payment terms", value: supplier.payment_terms_id ? "Recorded" : "Not recorded" },
                  { label: "Created", value: new Date(supplier.created_at).toLocaleString("en-GB") },
                  { label: "Last updated", value: new Date(supplier.updated_at).toLocaleString("en-GB") },
                ]}
              />
              {supplier.notes ? (
                <div className="mt-4 rounded-lg bg-surface-muted p-3">
                  <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-subtle">Notes</p>
                  <p className="mt-1 whitespace-pre-line text-xs text-ink">{supplier.notes}</p>
                </div>
              ) : null}
            </Card>

            <div className="space-y-4">
              <Card className="p-4">
                <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <ShieldCheck className="size-4 text-ink-subtle" aria-hidden /> Verification
                </h2>
                <DetailList
                  items={[
                    { label: "Status", value: labelFor(supplier.verification_status) },
                    { label: "Last verification", value: supplier.last_verification_date ?? "—" },
                    { label: "Verification notes", value: supplier.verification_notes ?? "—" },
                  ]}
                />
                <p className="mt-3 text-[0.6875rem] text-ink-subtle">
                  Verification and activation are independent. A verified supplier still cannot be used for procurement until it is active.
                </p>
              </Card>

              <Card className="p-4">
                <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Package className="size-4 text-ink-subtle" aria-hidden /> Approved supply
                </h2>
                {detail.productCategories.length === 0 ? (
                  <p className="text-xs text-ink-muted">No product categories approved yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {detail.productCategories.map((category) => (
                      <Badge key={category.id} tone="neutral">
                        {category.name}
                      </Badge>
                    ))}
                  </div>
                )}
                {canManage ? (
                  <div className="mt-3">
                    <RecordFormDialog
                      title="Approved product categories"
                      description="What this supplier is approved to supply. Multiple categories are allowed; this is not a restriction to a single commodity."
                      triggerLabel="Set categories"
                      trigger="edit"
                      action={setSupplierProductCategoriesAction}
                      hidden={{ supplierId: supplier.id }}
                      fields={[
                        {
                          name: "categoryIds",
                          label: "Approved product categories",
                          type: "select",
                          wide: true,
                          hint: "Hold Ctrl/⌘ to select several. Clearing the selection removes approval.",
                          options: detail.productCategories.map((category) => ({ value: category.id, label: category.name })),
                        },
                      ]}
                    />
                  </div>
                ) : null}
              </Card>
            </div>
          </div>
        ) : null}

        {tab === "contacts" ? (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Users className="size-4 text-ink-subtle" aria-hidden /> Contacts
              </h2>
              {canManage ? (
                <RecordFormDialog
                  title="Add contact"
                  description="Only one contact can be primary; setting a new primary clears the previous one."
                  triggerLabel="Add contact"
                  action={saveSupplierContactAction}
                  hidden={{ supplierId: supplier.id }}
                  fields={[
                    { name: "name", label: "Full name", required: true },
                    { name: "position", label: "Position" },
                    { name: "email", label: "Email", type: "email" },
                    { name: "phone", label: "Phone" },
                    { name: "alternatePhone", label: "Alternate phone" },
                    { name: "department", label: "Department" },
                    {
                      name: "preferredChannel",
                      label: "Preferred channel",
                      type: "select",
                      options: [
                        { value: "phone", label: "Phone" },
                        { value: "email", label: "Email" },
                        { value: "whatsapp", label: "WhatsApp" },
                        { value: "in_person", label: "In person" },
                      ],
                    },
                    { name: "isPrimary", label: "Primary contact", type: "checkbox" },
                    { name: "notes", label: "Notes", type: "textarea", wide: true },
                  ]}
                />
              ) : null}
            </div>
            {detail.contacts.length === 0 ? (
              <EmptyState icon={Users} title="No contacts recorded" description="A supplier with no named contact is harder to verify and to reach during procurement." />
            ) : (
              <TableWrapper>
                <Table className="min-w-[44rem]">
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Name</TH>
                      <TH>Role</TH>
                      <TH>Email</TH>
                      <TH>Phone</TH>
                      <TH>Primary</TH>
                      {canManage ? <TH className="text-right">Actions</TH> : null}
                    </TR>
                  </THead>
                  <TBody>
                    {detail.contacts.map((contact) => (
                      <TR key={contact.id}>
                        <TD className="text-xs font-medium">{contact.name}</TD>
                        <TD className="text-xs text-ink-muted">{contact.position ?? contact.department ?? "—"}</TD>
                        <TD className="text-xs">{contact.email ?? "—"}</TD>
                        <TD className="text-xs">{contact.phone ?? "—"}</TD>
                        <TD>{contact.is_primary ? <Badge tone="info">Primary</Badge> : "—"}</TD>
                        {canManage ? (
                          <TD className="text-right">
                            <ConfirmActionButton
                              action={removeSupplierContactAction}
                              label="Remove"
                              title={`Remove ${contact.name}?`}
                              description="The contact is deactivated, not deleted, so the change remains visible in the history."
                              confirmLabel="Remove contact"
                              hidden={{ id: contact.id, supplierId: supplier.id }}
                            />
                          </TD>
                        ) : null}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </Card>
        ) : null}

        {tab === "addresses" ? (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <MapPin className="size-4 text-ink-subtle" aria-hidden /> Addresses
              </h2>
              {canManage ? (
                <RecordFormDialog
                  title="Add address"
                  description="Supplier addresses carry a type: registered, operational, collection point or delivery."
                  triggerLabel="Add address"
                  action={saveSupplierAddressAction}
                  hidden={{ supplierId: supplier.id }}
                  fields={[
                    {
                      name: "addressType",
                      label: "Type",
                      type: "select",
                      required: true,
                      options: ADDRESS_TYPES.supplier.map((type) => ({ value: type, label: labelFor(type) })),
                    },
                    { name: "label", label: "Label" },
                    { name: "street", label: "Street address", wide: true },
                    { name: "city", label: "City" },
                    { name: "localGovernment", label: "Local government area" },
                    { name: "stateRegion", label: "State / region" },
                    { name: "postalCode", label: "Postal code" },
                    { name: "country", label: "Country", required: true },
                    { name: "isPrimary", label: "Primary address", type: "checkbox" },
                  ]}
                />
              ) : null}
            </div>
            {detail.addresses.length === 0 ? (
              <EmptyState icon={MapPin} title="No addresses recorded" description="Add a registered office address, and a collection point if goods are picked up elsewhere." />
            ) : (
              <ul className="divide-y divide-border">
                {detail.addresses.map((address) => (
                  <li key={address.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                        {labelFor(address.address_type)}
                        {address.is_primary ? <Badge tone="info">Primary</Badge> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {[address.street, address.city, address.local_government, address.state_region, address.postal_code, address.country]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                      {address.label ? <p className="text-[0.6875rem] text-ink-subtle">{address.label}</p> : null}
                    </div>
                    {canManage ? (
                      <ConfirmActionButton
                        action={removeSupplierAddressAction}
                        label="Remove"
                        title="Remove this address?"
                        description="The address is deactivated rather than deleted."
                        confirmLabel="Remove address"
                        hidden={{ id: address.id, supplierId: supplier.id }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {tab === "procurement" ? (
          <Card className="p-4">
            <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Package className="size-4 text-ink-subtle" aria-hidden /> Approved supply categories
            </h2>
            <p className="mb-3 max-w-3xl text-xs text-ink-muted">
              What this supplier is approved to supply. A supplier may hold several categories; nothing here limits it to a single commodity.
            </p>
            {detail.productCategories.length === 0 ? (
              <EmptyState title="No approved categories" description="Until a category is approved, this supplier has no recorded scope of supply." />
            ) : (
              <div className="flex flex-wrap gap-1">
                {detail.productCategories.map((category) => (
                  <Badge key={category.id} tone="neutral">
                    {category.name} · {category.code}
                  </Badge>
                ))}
              </div>
            )}
            {canManage ? (
              <div className="mt-4">
                <RecordFormDialog
                  title="Approved product categories"
                  description="Select every category this supplier is approved for."
                  triggerLabel="Set categories"
                  trigger="edit"
                  action={setSupplierProductCategoriesAction}
                  hidden={{ supplierId: supplier.id }}
                  fields={[
                    {
                      name: "categoryIds",
                      label: "Categories",
                      type: "select",
                      wide: true,
                      options: categories.map((category) => ({ value: category.id, label: category.name })),
                    },
                  ]}
                />
              </div>
            ) : null}
          </Card>
        ) : null}

        {tab === "banking" && canBank ? (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Landmark className="size-4 text-ink-subtle" aria-hidden /> Bank accounts
                </h2>
                <p className="text-[0.6875rem] text-ink-subtle">
                  Sensitive data. Account numbers are masked here; every change is audited, and a changed account number is audited as critical.
                </p>
              </div>
              {canManageBank ? (
                <RecordFormDialog
                  title="Add bank account"
                  description="Bank details are highly sensitive. They are restricted to authorised personnel and never written to ordinary logs."
                  triggerLabel="Add account"
                  action={saveSupplierBankAccountAction}
                  hidden={{ supplierId: supplier.id }}
                  fields={[
                    { name: "bankName", label: "Bank name", required: true },
                    { name: "accountHolderName", label: "Account holder name", required: true },
                    { name: "accountNumber", label: "Account number", required: true },
                    { name: "bankIdentifier", label: "Sort code / IBAN / SWIFT", hint: "Stored separately from the account number." },
                    { name: "branchName", label: "Branch" },
                    { name: "country", label: "Country (ISO 3166-1 alpha-2)" },
                    { name: "currencyCode", label: "Account currency" },
                    { name: "notes", label: "Notes", type: "textarea", wide: true },
                  ]}
                />
              ) : null}
            </div>
            {bankAccounts.length === 0 ? (
              <EmptyState icon={Landmark} title="No bank accounts recorded" description="Bank details are only added when they come from a verified source document. Nothing is pre-filled." />
            ) : (
              <TableWrapper>
                <Table className="min-w-[46rem]">
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Bank</TH>
                      <TH>Account holder</TH>
                      <TH>Account number</TH>
                      <TH>Currency</TH>
                      <TH>Verification</TH>
                      <TH>Status</TH>
                      {canManageBank ? <TH className="text-right">Actions</TH> : null}
                    </TR>
                  </THead>
                  <TBody>
                    {bankAccounts.map((account) => (
                      <TR key={account.id}>
                        <TD className="text-xs font-medium">{account.bank_name}</TD>
                        <TD className="text-xs">{account.account_holder_name}</TD>
                        <TD className="font-mono text-xs text-ink-muted">{account.account_number_masked}</TD>
                        <TD className="text-xs">{account.currency_code ?? "—"}</TD>
                        <TD>
                          <Badge tone={account.verification_status === "verified" ? "success" : account.verification_status === "rejected" ? "danger" : "neutral"}>
                            {labelFor(account.verification_status)}
                          </Badge>
                        </TD>
                        <TD>
                          <Badge tone={account.is_active ? "success" : "neutral"} dot>
                            {account.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TD>
                        {canManageBank ? (
                          <TD className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <RecordFormDialog
                                title="Verify bank account"
                                description="Verification confirms the account details were checked against a document or a call-back."
                                triggerLabel="Verify"
                                trigger="edit"
                                action={verifySupplierBankAccountAction}
                                hidden={{ id: account.id, supplierId: supplier.id }}
                                fields={[
                                  {
                                    name: "verificationStatus",
                                    label: "Outcome",
                                    type: "select",
                                    required: true,
                                    options: [
                                      { value: "pending", label: "Pending" },
                                      { value: "verified", label: "Verified" },
                                      { value: "rejected", label: "Rejected" },
                                      { value: "unverified", label: "Back to unverified" },
                                    ],
                                  },
                                ]}
                              />
                              <ConfirmActionButton
                                action={removeSupplierBankAccountAction}
                                label="Deactivate"
                                title="Deactivate this bank account?"
                                description="Accounts are never hard-deleted. A reason is required and recorded in the audit trail."
                                confirmLabel="Deactivate account"
                                reasonRequired
                                hidden={{ id: account.id, supplierId: supplier.id }}
                              />
                            </div>
                          </TD>
                        ) : null}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </Card>
        ) : null}

        {tab === "documents" ? (
          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">Documents</h2>
              <p className="text-[0.6875rem] text-ink-subtle">
                Document metadata is recorded; file storage is not enabled in this environment, so no upload control is shown.
              </p>
            </div>
            {detail.documents.length === 0 ? (
              <EmptyState title="No documents recorded" description="Registration certificates, tax documents and bank letters are recorded as metadata with an expiry date." />
            ) : (
              <TableWrapper>
                <Table className="min-w-[40rem]">
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Type</TH>
                      <TH>Title</TH>
                      <TH>Reference</TH>
                      <TH>Issued</TH>
                      <TH>Expires</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {detail.documents.map((document) => (
                      <TR key={document.id}>
                        <TD className="text-xs">{labelFor(document.document_type)}</TD>
                        <TD className="text-xs font-medium">{document.title}</TD>
                        <TD className="text-xs text-ink-muted">{document.reference_number ?? "—"}</TD>
                        <TD className="text-xs">{document.issued_on ?? "—"}</TD>
                        <TD className="text-xs">{document.expires_on ?? "—"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </Card>
        ) : null}

        {tab === "history" ? (
          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <History className="size-4 text-ink-subtle" aria-hidden /> Change history
              </h2>
              <p className="text-[0.6875rem] text-ink-subtle">Written by a database trigger on every update, so no change can bypass the trail.</p>
            </div>
            {detail.history.length === 0 ? (
              <EmptyState title="No changes recorded" description="This record has not been modified since it was created." />
            ) : (
              <ul className="divide-y divide-border">
                {detail.history.map((entry) => (
                  <li key={entry.id} className="px-4 py-2.5">
                    <p className="text-xs font-medium text-ink">
                      {labelFor(entry.change_type)}
                      {entry.changed_fields.length > 0 ? (
                        <span className="font-normal text-ink-muted"> · {entry.changed_fields.join(", ")}</span>
                      ) : null}
                    </p>
                    <p className="text-[0.6875rem] text-ink-subtle">
                      {new Date(entry.created_at).toLocaleString("en-GB")} · {entry.actor?.display_name ?? "System"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
