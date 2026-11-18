"use server";

import { headers } from "next/headers";

import { actionFailure, actionSuccess, type ActionResult } from "@/lib/errors";
import { formValue } from "@/lib/validation/common";
import {
  changeCustomerStatus,
  createCustomer,
  removeCustomerAddress,
  removeCustomerContact,
  saveCustomerAddress,
  saveCustomerContact,
  saveCustomerCredit,
  updateCustomer,
} from "@/services/master-data/customers";
import { saveCustomerCategory, saveSupplierCategory } from "@/services/master-data/categories";
import {
  saveCurrency,
  saveDeliveryTerm,
  saveExchangeRate,
  savePaymentTerm,
  saveTaxCategory,
} from "@/services/master-data/commercial";
import { detectDuplicates, resolveDuplicate } from "@/services/master-data/duplicates";
import { executeImport, stageImport } from "@/services/master-data/imports";
import { saveSite, saveWarehouse, saveWarehouseLocation } from "@/services/master-data/locations";
import {
  changeProductStatus,
  createProduct,
  removeProductPackaging,
  removeProductSpecification,
  saveProductAttributeValue,
  saveProductCategory,
  saveProductPackaging,
  saveProductSpecification,
  saveProductVariant,
  updateProduct,
} from "@/services/master-data/products";
import { removeSupplierBankAccount, saveSupplierBankAccount, verifySupplierBankAccount } from "@/services/master-data/supplier-banking";
import {
  changeSupplierStatus,
  createSupplier,
  removeSupplierAddress,
  removeSupplierContact,
  saveSupplierAddress,
  saveSupplierContact,
  setSupplierProductCategories,
  updateSupplier,
  verifySupplier,
} from "@/services/master-data/suppliers";
import { previewConversion, saveUnit, saveUnitConversion } from "@/services/master-data/units";
import type { RequestMeta } from "@/services/employees/manage-employee";

async function requestMeta(): Promise<RequestMeta> {
  const headerStore = await headers();
  return {
    ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerStore.get("user-agent"),
    requestId: headerStore.get("x-request-id"),
  };
}

/** Reads the submitted form into the camelCase shape the Zod schemas expect. */
function readForm(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

function wrap<T>(handler: () => Promise<T>): Promise<ActionResult<T>> {
  return handler()
    .then((data) => actionSuccess(data))
    .catch((error: unknown) => actionFailure(error));
}

// ---------------------------------------------------------------- suppliers
export async function createSupplierAction(_prev: ActionResult<{ id: string }> | null, formData: FormData) {
  return wrap(async () => {
    const supplier = await createSupplier(readForm(formData), await requestMeta());
    return { id: supplier.id };
  });
}

export async function updateSupplierAction(_prev: ActionResult<{ id: string }> | null, formData: FormData) {
  return wrap(async () => {
    const supplier = await updateSupplier(readForm(formData), await requestMeta());
    return { id: supplier.id };
  });
}

export async function changeSupplierStatusAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await changeSupplierStatus(
      { id: formData.get("id"), status: formValue(formData.get("status")), reason: formValue(formData.get("reason")) },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function verifySupplierAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await verifySupplier(
      {
        id: formData.get("id"),
        verificationStatus: formValue(formData.get("verificationStatus")),
        notes: formValue(formData.get("notes")),
        verifiedOn: formValue(formData.get("verifiedOn")) || undefined,
      },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function saveSupplierContactAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveSupplierContact(
      { ...readForm(formData), isPrimary: checkbox(formData, "isPrimary") },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function removeSupplierContactAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await removeSupplierContact(
      { id: formValue(formData.get("id")), supplierId: formValue(formData.get("supplierId")) },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function saveSupplierAddressAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveSupplierAddress({ ...readForm(formData), isPrimary: checkbox(formData, "isPrimary") }, await requestMeta());
    return undefined;
  });
}

export async function removeSupplierAddressAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await removeSupplierAddress(
      { id: formValue(formData.get("id")), supplierId: formValue(formData.get("supplierId")) },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function saveSupplierBankAccountAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveSupplierBankAccount(readForm(formData), await requestMeta());
    return undefined;
  });
}

export async function verifySupplierBankAccountAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await verifySupplierBankAccount(
      {
        id: formValue(formData.get("id")),
        supplierId: formValue(formData.get("supplierId")),
        verificationStatus: formValue(formData.get("verificationStatus")) as "unverified" | "pending" | "verified" | "rejected",
      },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function removeSupplierBankAccountAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await removeSupplierBankAccount(
      {
        id: formValue(formData.get("id")),
        supplierId: formValue(formData.get("supplierId")),
        reason: formValue(formData.get("reason")),
      },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function setSupplierProductCategoriesAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await setSupplierProductCategories(
      {
        supplierId: formValue(formData.get("supplierId")),
        categoryIds: formData.getAll("categoryIds").map((value) => String(value)),
      },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function saveSupplierCategoryAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveSupplierCategory(
      {
        ...readForm(formData),
        sortOrder: formData.get("sortOrder") ? Number(formData.get("sortOrder")) : undefined,
        isActive: checkbox(formData, "isActive"),
      },
      await requestMeta(),
    );
    return undefined;
  });
}

// ---------------------------------------------------------------- customers
export async function createCustomerAction(_prev: ActionResult<{ id: string }> | null, formData: FormData) {
  return wrap(async () => {
    const customer = await createCustomer(readForm(formData), await requestMeta());
    return { id: customer.id };
  });
}

export async function updateCustomerAction(_prev: ActionResult<{ id: string }> | null, formData: FormData) {
  return wrap(async () => {
    const customer = await updateCustomer(readForm(formData), await requestMeta());
    return { id: customer.id };
  });
}

export async function changeCustomerStatusAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await changeCustomerStatus(
      { id: formData.get("id"), status: formValue(formData.get("status")), reason: formValue(formData.get("reason")) },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function saveCustomerContactAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveCustomerContact({ ...readForm(formData), isPrimary: checkbox(formData, "isPrimary") }, await requestMeta());
    return undefined;
  });
}

export async function removeCustomerContactAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await removeCustomerContact(
      { id: formValue(formData.get("id")), customerId: formValue(formData.get("customerId")) },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function saveCustomerAddressAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveCustomerAddress({ ...readForm(formData), isPrimary: checkbox(formData, "isPrimary") }, await requestMeta());
    return undefined;
  });
}

export async function removeCustomerAddressAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await removeCustomerAddress(
      { id: formValue(formData.get("id")), customerId: formValue(formData.get("customerId")) },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function saveCustomerCreditAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveCustomerCredit(readForm(formData), await requestMeta());
    return undefined;
  });
}

export async function saveCustomerCategoryAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveCustomerCategory(
      {
        ...readForm(formData),
        sortOrder: formData.get("sortOrder") ? Number(formData.get("sortOrder")) : undefined,
        isActive: checkbox(formData, "isActive"),
      },
      await requestMeta(),
    );
    return undefined;
  });
}

// ---------------------------------------------------------------- products
export async function createProductAction(_prev: ActionResult<{ id: string }> | null, formData: FormData) {
  return wrap(async () => {
    const product = await createProduct(readForm(formData), await requestMeta());
    return { id: product.id };
  });
}

export async function updateProductAction(_prev: ActionResult<{ id: string }> | null, formData: FormData) {
  return wrap(async () => {
    const product = await updateProduct(readForm(formData), await requestMeta());
    return { id: product.id };
  });
}

export async function changeProductStatusAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await changeProductStatus(
      { id: formData.get("id"), status: formValue(formData.get("status")), reason: formValue(formData.get("reason")) },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function saveProductCategoryAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveProductCategory(
      {
        ...readForm(formData),
        sortOrder: formData.get("sortOrder") ? Number(formData.get("sortOrder")) : undefined,
        isActive: checkbox(formData, "isActive"),
      },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function saveProductVariantAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveProductVariant({ ...readForm(formData), isDefault: checkbox(formData, "isDefault") }, await requestMeta());
    return undefined;
  });
}

export async function saveProductSpecificationAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveProductSpecification(
      { ...readForm(formData), isCritical: checkbox(formData, "isCritical") },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function removeProductSpecificationAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await removeProductSpecification(
      { id: formValue(formData.get("id")), productId: formValue(formData.get("productId")) },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function saveProductAttributeValueAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveProductAttributeValue(readForm(formData), await requestMeta());
    return undefined;
  });
}

export async function saveProductPackagingAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveProductPackaging({ ...readForm(formData), isDefault: checkbox(formData, "isDefault") }, await requestMeta());
    return undefined;
  });
}

export async function removeProductPackagingAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await removeProductPackaging(
      { id: formValue(formData.get("id")), productId: formValue(formData.get("productId")) },
      await requestMeta(),
    );
    return undefined;
  });
}

// ---------------------------------------------------------------- measurement
export async function saveUnitAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveUnit(
      {
        ...readForm(formData),
        precision: formData.get("precision") ? Number(formData.get("precision")) : 3,
        isBaseUnit: checkbox(formData, "isBaseUnit"),
        isActive: checkbox(formData, "isActive"),
      },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function saveUnitConversionAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveUnitConversion(readForm(formData), await requestMeta());
    return undefined;
  });
}

// ---------------------------------------------------------------- locations
export async function saveSiteAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveSite({ ...readForm(formData), isActive: checkbox(formData, "isActive") }, await requestMeta());
    return undefined;
  });
}

export async function saveWarehouseAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveWarehouse({ ...readForm(formData), isActive: checkbox(formData, "isActive") }, await requestMeta());
    return undefined;
  });
}

export async function saveWarehouseLocationAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveWarehouseLocation({ ...readForm(formData), isActive: checkbox(formData, "isActive") }, await requestMeta());
    return undefined;
  });
}

// ---------------------------------------------------------------- commercial references
export async function saveCurrencyAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveCurrency(
      {
        ...readForm(formData),
        decimalPlaces: formData.get("decimalPlaces") ? Number(formData.get("decimalPlaces")) : 2,
        isActive: checkbox(formData, "isActive"),
      },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function saveExchangeRateAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveExchangeRate(readForm(formData), await requestMeta());
    return undefined;
  });
}

export async function savePaymentTermAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await savePaymentTerm({ ...readForm(formData), isActive: checkbox(formData, "isActive") }, await requestMeta());
    return undefined;
  });
}

export async function saveDeliveryTermAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveDeliveryTerm({ ...readForm(formData), isActive: checkbox(formData, "isActive") }, await requestMeta());
    return undefined;
  });
}

export async function saveTaxCategoryAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await saveTaxCategory({ ...readForm(formData), isActive: checkbox(formData, "isActive") }, await requestMeta());
    return undefined;
  });
}

// ---------------------------------------------------------------- governance
export async function detectDuplicatesAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await detectDuplicates(formValue(formData.get("entity")) === "customer" ? "customer" : "supplier", await requestMeta());
    return undefined;
  });
}

export async function resolveDuplicateAction(_prev: ActionResult<undefined> | null, formData: FormData) {
  return wrap(async () => {
    await resolveDuplicate(
      {
        id: formValue(formData.get("id")),
        status: formValue(formData.get("status")),
        notes: formValue(formData.get("notes")),
      },
      await requestMeta(),
    );
    return undefined;
  });
}

export async function stageImportAction(_prev: ActionResult<unknown> | null, formData: FormData) {
  return wrap(async () => {
    const preview = await stageImport(
      {
        entityType: formValue(formData.get("entityType")),
        fileName: formValue(formData.get("fileName")) || "upload.csv",
        content: formValue(formData.get("content")),
      },
      await requestMeta(),
    );
    return {
      jobId: preview.jobId,
      entityType: preview.entityType,
      headers: preview.headers,
      accepted: preview.accepted.length,
      rejected: preview.rejected.length,
      rejectedRows: preview.rejected.slice(0, 25),
      structuralErrors: preview.structuralErrors,
    };
  });
}

export async function executeImportAction(_prev: ActionResult<{ imported: number; skipped: number }> | null, formData: FormData) {
  return wrap(async () => {
    const result = await executeImport({ jobId: formValue(formData.get("jobId")) }, await requestMeta());
    return { imported: result.imported, skipped: result.skipped };
  });
}

export async function previewConversionAction(_prev: ActionResult<unknown> | null, formData: FormData) {
  return wrap(async () =>
    previewConversion({
      quantity: formValue(formData.get("quantity")) || "1",
      fromUnitId: formValue(formData.get("fromUnitId")),
      toUnitId: formValue(formData.get("toUnitId")),
      productId: formValue(formData.get("productId")) || null,
    }),
  );
}
