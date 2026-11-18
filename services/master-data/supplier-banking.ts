import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supplierBankAccountSchema } from "@/lib/validation/master-data.schemas";
import { requirePermission } from "@/services/authorization";
import { getActiveProfileId } from "@/services/master-data/helpers";
import { recordMasterAudit, translateDatabaseError } from "@/services/master-data/shared";
import type { SupplierBankAccount } from "@/types/database.types";
import type { RequestMeta } from "@/services/employees/manage-employee";

/**
 * Sensitive supplier banking data.
 *
 * Three defences, in depth:
 *  1. RLS: `supplier_bank_accounts` policies require master_data.supplier_banking.view for SELECT,
 *     so a user without it gets zero rows even through a crafted API call.
 *  2. Application: this module only ever returns masked account numbers to the UI, and there is no
 *     general-purpose query elsewhere in the codebase that selects this table.
 *  3. Audit: every read of the full number for editing, and every write, is audited at warning or
 *     critical severity. Account numbers are never written to logs.
 */

export type MaskedBankAccount = Omit<SupplierBankAccount, "account_number"> & { account_number_masked: string };

/** Masks all but the last four digits: "•••• •••• 4821". */
export function maskAccountNumber(value: string): string {
  const digits = value.replace(/\s/g, "");
  if (digits.length <= 4) return "••••";
  return `${"•".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

export async function getSupplierBankAccounts(supplierId: string): Promise<MaskedBankAccount[]> {
  await requirePermission("master_data.supplier_banking.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("supplier_bank_accounts")
    .select("*")
    .eq("supplier_id", supplierId)
    .order("is_active", { ascending: false })
    .returns<SupplierBankAccount[]>();
  if (error) throw translateDatabaseError(error, "The supplier bank accounts");

  return (data ?? []).map((row) => {
    const { account_number: accountNumber, ...rest } = row;
    return { ...rest, account_number_masked: maskAccountNumber(accountNumber) };
  });
}

export async function saveSupplierBankAccount(input: unknown, meta: RequestMeta = {}): Promise<MaskedBankAccount> {
  await requirePermission("master_data.supplier_banking.manage");
  const payload = supplierBankAccountSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  let existing: SupplierBankAccount | null = null;
  if (payload.id) {
    const { data } = await supabase
      .from("supplier_bank_accounts")
      .select("*")
      .eq("id", payload.id)
      .maybeSingle<SupplierBankAccount>();
    existing = data ?? null;
    if (!existing) throw new AppError("NOT_FOUND", "That bank account no longer exists.");
  }

  const accountChanged =
    existing !== null &&
    (existing.account_number !== payload.accountNumber || existing.bank_identifier !== (payload.bankIdentifier || null));

  const record = {
    supplier_id: payload.supplierId,
    bank_name: payload.bankName,
    account_holder_name: payload.accountHolderName,
    account_number: payload.accountNumber,
    branch_name: payload.branchName || null,
    bank_identifier: payload.bankIdentifier || null,
    country: payload.country || null,
    currency_code: payload.currencyCode,
    verification_status: payload.verificationStatus ?? "unverified",
    notes: payload.notes || null,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("supplier_bank_accounts").update(record).eq("id", payload.id).select("*").single<SupplierBankAccount>()
    : await supabase
        .from("supplier_bank_accounts")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<SupplierBankAccount>();

  if (error) throw translateDatabaseError(error, "The supplier bank account");

  await recordMasterAudit(
    {
      action: "master_data.banking_changed",
      entityType: "supplier_bank_account",
      entityId: data.id,
      // Only the masked number is recorded. The audit trail must not become a second copy of the
      // banking database.
      description: `Bank account ending ${maskAccountNumber(data.account_number).slice(-4)} saved for supplier.`,
      severity: accountChanged ? "critical" : "warning",
      oldValues: existing
        ? { bank_name: existing.bank_name, account_number_masked: maskAccountNumber(existing.account_number) }
        : null,
      newValues: {
        bank_name: data.bank_name,
        account_number_masked: maskAccountNumber(data.account_number),
        currency_code: data.currency_code,
        verification_status: data.verification_status,
      },
      metadata: { reason: payload.changeReason ?? null, account_changed: accountChanged },
    },
    meta,
  );

  revalidatePath(`/master-data/suppliers/${payload.supplierId}`);
  const { account_number: accountNumber, ...rest } = data;
  return { ...rest, account_number_masked: maskAccountNumber(accountNumber) };
}

export async function verifySupplierBankAccount(
  input: { id: string; supplierId: string; verificationStatus: "unverified" | "pending" | "verified" | "rejected" },
  meta: RequestMeta = {},
): Promise<void> {
  await requirePermission("master_data.supplier_banking.manage");
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { error } = await supabase
    .from("supplier_bank_accounts")
    .update({
      verification_status: input.verificationStatus,
      verified_by: profileId,
      verified_at: new Date().toISOString(),
      updated_by: profileId,
    })
    .eq("id", input.id);
  if (error) throw translateDatabaseError(error, "The bank account verification");

  await recordMasterAudit(
    {
      action: "master_data.verified",
      entityType: "supplier_bank_account",
      entityId: input.id,
      description: `Bank account verification set to ${input.verificationStatus}.`,
      severity: "warning",
      newValues: { verification_status: input.verificationStatus },
    },
    meta,
  );

  revalidatePath(`/master-data/suppliers/${input.supplierId}`);
}

export async function removeSupplierBankAccount(
  input: { id: string; supplierId: string; reason: string },
  meta: RequestMeta = {},
): Promise<void> {
  await requirePermission("master_data.supplier_banking.manage");
  if (input.reason.trim().length < 10) {
    throw new AppError("VALIDATION_ERROR", "Give a short reason (at least 10 characters) for removing a bank account.");
  }
  const supabase = await createSupabaseServerClient();

  // Deactivated rather than deleted: a removed account may still be referenced by a future payment.
  const { error } = await supabase
    .from("supplier_bank_accounts")
    .update({ is_active: false, notes: input.reason.trim() })
    .eq("id", input.id);
  if (error) throw translateDatabaseError(error, "The supplier bank account");

  await recordMasterAudit(
    {
      action: "master_data.banking_changed",
      entityType: "supplier_bank_account",
      entityId: input.id,
      description: "Bank account deactivated.",
      severity: "critical",
      metadata: { reason: input.reason.trim() },
    },
    meta,
  );

  revalidatePath(`/master-data/suppliers/${input.supplierId}`);
}
