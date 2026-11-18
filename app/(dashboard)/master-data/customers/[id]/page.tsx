import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CreditCard, History, MapPin, ShieldAlert, Users } from "lucide-react";

import { ConfirmActionButton } from "@/components/master-data/confirm-action-button";
import { DetailList } from "@/components/master-data/detail-list";
import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { SectionTabs } from "@/components/master-data/section-tabs";
import { StatusTransitionDialog } from "@/components/master-data/status-transition-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import {
  changeCustomerStatusAction,
  removeCustomerAddressAction,
  removeCustomerContactAction,
  saveCustomerAddressAction,
  saveCustomerContactAction,
  saveCustomerCreditAction,
} from "@/app/(dashboard)/master-data/actions";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { ADDRESS_TYPES, MASTER_STATUS_LABELS, labelFor, masterStatusTone } from "@/lib/master-data/statuses";
import { cn } from "@/lib/utils";
import { getCustomer, getCustomerCredit } from "@/services/master-data/customers";
import { getAvailableTransitions } from "@/services/master-data/status-transitions";

export const metadata: Metadata = { title: "Customer" };
export const dynamic = "force-dynamic";

const TAB_KEYS = ["overview", "contacts", "addresses", "credit", "documents", "history"] as const;

export default async function CustomerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const requested = (Array.isArray(query.tab) ? query.tab[0] : query.tab) ?? "overview";
  const tab = (TAB_KEYS as readonly string[]).includes(requested) ? requested : "overview";

  const { allowed, principal } = await guardMasterDataPage("master_data.customers.view");
  if (!allowed) return <PermissionGuard permission="master_data.customers.view" />;

  const detail = await getCustomer(id);
  if (!detail) notFound();

  const { customer } = detail;
  const canManage = principal.permissions.has("master_data.customers.update");
  const canSeeCredit = principal.permissions.has("master_data.customer_credit.view");
  const canManageCredit = principal.permissions.has("master_data.customer_credit.manage");

  const [transitions, credit] = await Promise.all([
    getAvailableTransitions("customer", customer.status),
    canSeeCredit ? getCustomerCredit(customer.id) : Promise.resolve(null),
  ]);

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "contacts", label: "Contacts", count: detail.contacts.length },
    { key: "addresses", label: "Addresses", count: detail.addresses.length },
    ...(canSeeCredit ? [{ key: "credit", label: "Credit reference" }] : []),
    { key: "documents", label: "Documents", count: detail.documents.length },
    { key: "history", label: "History", count: detail.history.length },
  ];

  return (
    <div>
      <PageHeader
        title={customer.legal_name}
        description={`Customer ${customer.reference} · ${labelFor(customer.customer_type)}`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Customers", href: "/master-data/customers" },
          { label: customer.reference },
        ]}
        badge={
          <Badge tone={masterStatusTone(customer.status)} dot>
            {MASTER_STATUS_LABELS[customer.status] ?? customer.status}
          </Badge>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManage ? (
              <Link href={`/master-data/customers/${customer.id}/edit`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
                Edit
              </Link>
            ) : null}
            {transitions.length > 0 ? (
              <StatusTransitionDialog
                id={customer.id}
                entityLabel="Customer"
                currentStatus={MASTER_STATUS_LABELS[customer.status] ?? customer.status}
                options={transitions}
                action={changeCustomerStatusAction}
              />
            ) : null}
          </div>
        }
      />

      <SectionTabs base={`/master-data/customers/${customer.id}`} active={tab} tabs={tabs} />

      <div className="mt-4 space-y-4">
        {tab === "overview" ? (
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Identity &amp; registration</h2>
            <DetailList
              items={[
                { label: "Reference", value: <span className="font-mono">{customer.reference}</span> },
                { label: "Legal name", value: customer.legal_name },
                { label: "Trading name", value: customer.trading_name ?? "—" },
                { label: "Customer type", value: labelFor(customer.customer_type) },
                { label: "Primary category", value: detail.category?.name ?? "—" },
                { label: "Country of registration", value: customer.registration_country ?? "—" },
                { label: "Registration number", value: customer.registration_number ?? "—" },
                { label: "Tax identification number", value: customer.tax_identification_number ?? "—" },
                { label: "Preferred currency", value: customer.preferred_currency_code ?? "—" },
                { label: "Primary contact", value: customer.contact_name ?? "—" },
                { label: "Contact email", value: customer.contact_email ?? "—" },
                { label: "Contact phone", value: customer.contact_phone ?? "—" },
                { label: "Created", value: new Date(customer.created_at).toLocaleString("en-GB") },
                { label: "Last updated", value: new Date(customer.updated_at).toLocaleString("en-GB") },
              ]}
            />
            {customer.notes ? (
              <div className="mt-4 rounded-lg bg-surface-muted p-3">
                <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-subtle">Notes</p>
                <p className="mt-1 whitespace-pre-line text-xs text-ink">{customer.notes}</p>
              </div>
            ) : null}
          </Card>
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
                  action={saveCustomerContactAction}
                  hidden={{ customerId: customer.id }}
                  fields={[
                    { name: "name", label: "Full name", required: true },
                    { name: "jobTitle", label: "Job title" },
                    {
                      name: "department",
                      label: "Department",
                      type: "select",
                      options: [
                        { value: "purchasing", label: "Purchasing" },
                        { value: "finance", label: "Finance" },
                        { value: "quality", label: "Quality" },
                        { value: "logistics", label: "Logistics" },
                        { value: "management", label: "Management" },
                        { value: "other", label: "Other" },
                      ],
                    },
                    { name: "email", label: "Email", type: "email" },
                    { name: "phone", label: "Phone" },
                    { name: "whatsappNumber", label: "WhatsApp number" },
                    { name: "isPrimary", label: "Primary contact", type: "checkbox" },
                    { name: "notes", label: "Notes", type: "textarea", wide: true },
                  ]}
                />
              ) : null}
            </div>
            {detail.contacts.length === 0 ? (
              <EmptyState icon={Users} title="No contacts recorded" description="Add the person who actually places or receives orders." />
            ) : (
              <TableWrapper>
                <Table className="min-w-[40rem]">
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Name</TH>
                      <TH>Position</TH>
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
                        <TD className="text-xs text-ink-muted">{contact.job_title ?? contact.department ?? "—"}</TD>
                        <TD className="text-xs">{contact.email ?? "—"}</TD>
                        <TD className="text-xs">{contact.phone ?? "—"}</TD>
                        <TD>{contact.is_primary ? <Badge tone="info">Primary</Badge> : "—"}</TD>
                        {canManage ? (
                          <TD className="text-right">
                            <ConfirmActionButton
                              action={removeCustomerContactAction}
                              label="Remove"
                              title="Remove this contact?"
                              description="The contact is deactivated rather than deleted."
                              confirmLabel="Remove contact"
                              hidden={{ id: contact.id, customerId: customer.id }}
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
                  description="Billing and delivery addresses are often different, and a customer may receive goods at a warehouse."
                  triggerLabel="Add address"
                  action={saveCustomerAddressAction}
                  hidden={{ customerId: customer.id }}
                  fields={[
                    {
                      name: "addressType",
                      label: "Type",
                      type: "select",
                      required: true,
                      options: ADDRESS_TYPES.customer.map((type) => ({ value: type, label: labelFor(type) })),
                    },
                    { name: "label", label: "Label" },
                    { name: "street", label: "Street address", wide: true },
                    { name: "city", label: "City" },
                    { name: "stateRegion", label: "State / region" },
                    { name: "postalCode", label: "Postal code" },
                    { name: "country", label: "Country", required: true },
                    { name: "isPrimary", label: "Primary address", type: "checkbox" },
                  ]}
                />
              ) : null}
            </div>
            {detail.addresses.length === 0 ? (
              <EmptyState icon={MapPin} title="No addresses recorded" description="Record the billing address and any delivery points." />
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
                        {[address.street, address.city, address.state_region, address.postal_code, address.country]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    </div>
                    {canManage ? (
                      <ConfirmActionButton
                        action={removeCustomerAddressAction}
                        label="Remove"
                        title="Remove this address?"
                        description="The address is deactivated rather than deleted."
                        confirmLabel="Remove address"
                        hidden={{ id: address.id, customerId: customer.id }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {tab === "credit" && canSeeCredit ? (
          <Card className="p-4">
            <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
              <CreditCard className="size-4 text-ink-subtle" aria-hidden /> Credit reference
            </h2>
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-pending-50 p-2.5 text-[0.6875rem] text-ink">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <p>
                Reference information only. A stored limit does not authorise a credit sale, and no credit policy is applied here — credit terms are a
                Finance and Management decision.
              </p>
            </div>
            {credit ? (
              <DetailList
                items={[
                  { label: "Credit status", value: labelFor(credit.credit_status) },
                  { label: "Credit limit", value: credit.credit_limit ? `${String(credit.credit_limit)} ${credit.credit_currency_code ?? ""}` : "Not recorded" },
                  { label: "Risk category", value: credit.risk_category ?? "—" },
                  { label: "Review date", value: credit.credit_review_date ?? "—" },
                  { label: "Assessed", value: credit.assessed_at ? new Date(credit.assessed_at).toLocaleString("en-GB") : "—" },
                  { label: "Notes", value: credit.credit_notes ?? "—" },
                ]}
              />
            ) : (
              <EmptyState title="No credit reference recorded" description="Nothing is recorded, so no limit can be assumed." />
            )}
            {canManageCredit ? (
              <div className="mt-4">
                <RecordFormDialog
                  title="Credit reference"
                  description="Recorded as assessed by Finance. This does not enable credit sales and no ageing or limit check is calculated."
                  triggerLabel={credit ? "Update reference" : "Record reference"}
                  trigger="edit"
                  action={saveCustomerCreditAction}
                  hidden={{ customerId: customer.id }}
                  fields={[
                    {
                      name: "creditStatus",
                      label: "Credit status",
                      type: "select",
                      required: true,
                      options: [
                        { value: "not_assessed", label: "Not assessed" },
                        { value: "pending_review", label: "Pending review" },
                        { value: "approved", label: "Approved" },
                        { value: "suspended", label: "Suspended" },
                        { value: "withdrawn", label: "Withdrawn" },
                      ],
                    },
                    { name: "creditLimit", label: "Credit limit", hint: "Decimal, stored as NUMERIC. Leave blank if not assessed." },
                    { name: "creditCurrencyCode", label: "Limit currency" },
                    { name: "creditReviewDate", label: "Next review date", type: "date" },
                    { name: "riskCategory", label: "Risk category" },
                    { name: "creditNotes", label: "Assessment notes", type: "textarea", wide: true },
                  ]}
                  values={{
                    creditStatus: credit?.credit_status ?? "not_assessed",
                    creditLimit: credit?.credit_limit ? String(credit.credit_limit) : "",
                    creditCurrencyCode: credit?.credit_currency_code ?? "",
                    creditReviewDate: credit?.credit_review_date ?? "",
                    riskCategory: credit?.risk_category ?? "",
                    creditNotes: credit?.credit_notes ?? "",
                  }}
                />
              </div>
            ) : null}
          </Card>
        ) : null}

        {tab === "documents" ? (
          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">Documents</h2>
              <p className="text-[0.6875rem] text-ink-subtle">Document metadata only. File storage is not enabled in this environment.</p>
            </div>
            {detail.documents.length === 0 ? (
              <EmptyState title="No documents recorded" description="Registration and tax documents are recorded here with their expiry dates." />
            ) : (
              <TableWrapper>
                <Table className="min-w-[36rem]">
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Type</TH>
                      <TH>Title</TH>
                      <TH>Reference</TH>
                      <TH>Expires</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {detail.documents.map((document) => (
                      <TR key={document.id}>
                        <TD className="text-xs">{labelFor(document.document_type)}</TD>
                        <TD className="text-xs font-medium">{document.title}</TD>
                        <TD className="text-xs text-ink-muted">{document.reference_number ?? "—"}</TD>
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
            </div>
            {detail.history.length === 0 ? (
              <EmptyState title="No changes recorded" description="This record has not been modified since creation." />
            ) : (
              <ul className="divide-y divide-border">
                {detail.history.map((entry) => (
                  <li key={entry.id} className="px-4 py-2.5">
                    <p className="text-xs font-medium text-ink">
                      {labelFor(entry.change_type)}
                      {entry.changed_fields.length > 0 ? <span className="font-normal text-ink-muted"> · {entry.changed_fields.join(", ")}</span> : null}
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
