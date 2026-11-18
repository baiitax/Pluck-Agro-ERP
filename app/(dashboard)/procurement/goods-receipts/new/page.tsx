import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/procurement/action-form";
import { ReceiptLinesEditor } from "@/components/procurement/receipt-lines-editor";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { requireActiveProfile } from "@/services/authorization";
import { getReceivableOrder, getReceivableOrders } from "@/services/procurement/goods-receipts";
import { createGoodsReceiptAction } from "../../actions";

export const metadata: Metadata = { title: "Record a goods receipt" };
export const dynamic = "force-dynamic";

const today = () => new Date().toISOString().slice(0, 10);

const qty = (value: number) => new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(value);

export default async function NewGoodsReceiptPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.goods_receipt.create")) {
    return <PermissionGuard permission="procurement.goods_receipt.create" />;
  }

  const params = await searchParams;
  const orderId = typeof params.order === "string" ? params.order : undefined;
  const details = orderId ? await getReceivableOrder(orderId) : null;
  const orders = details ? [] : await getReceivableOrders();

  const header = (
    <PageHeader
      title="Record a goods receipt"
      description="Record what actually arrived against an issued order. The receiver states the split between accepted, rejected and quarantined goods; the receipt stays evidence until it is posted, and posting is what creates stock."
      breadcrumbs={[
        { label: "Procurement", href: "/procurement" },
        { label: "Goods receipts", href: "/procurement/goods-receipts" },
        { label: "Record" },
      ]}
    />
  );

  if (!details) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <CardHeader>
            <CardTitle>Orders awaiting delivery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-0">
            {orders.length === 0 ? (
              <p className="px-4 pb-4 text-xs text-ink-muted">
                No issued order has an outstanding quantity. Nothing can be received until an order is issued and the
                supplier delivers against it.
              </p>
            ) : (
              <>
                <p className="px-4 text-xs text-ink-muted">
                  Choose the order the delivery belongs to. The receipt is tied to that order, so the quantity received can
                  never exceed what was ordered.
                </p>
                <TableWrapper>
                  <Table>
                    <THead>
                      <TR className="hover:bg-transparent">
                        <TH>Order</TH>
                        <TH>Supplier</TH>
                        <TH>Status</TH>
                        <TH>Expected</TH>
                        <TH className="text-right">Outstanding</TH>
                        <TH />
                      </TR>
                    </THead>
                    <TBody>
                      {orders.map((order) => (
                        <TR key={order.purchase_order_id}>
                          <TD className="font-medium">{order.reference}</TD>
                          <TD>{order.supplier_name_snapshot}</TD>
                          <TD className="text-xs text-ink-muted">
                            {order.is_overdue ? <span className="text-danger-700">Overdue</span> : "Awaiting delivery"}
                          </TD>
                          <TD>{order.expected_delivery_date ? formatDate(order.expected_delivery_date) : "—"}</TD>
                          <TD className="text-right tabular-nums">{qty(order.outstanding_quantity)}</TD>
                          <TD className="text-right">
                            <Link
                              href={`/procurement/goods-receipts/new?order=${order.purchase_order_id}`}
                              className="text-xs font-medium text-brand-700 hover:underline"
                            >
                              Receive against this order
                            </Link>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrapper>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { order, items, warehouses, locations, employees, settings } = details;
  const totalOutstanding = items.reduce((sum, item) => sum + Number(item.outstanding_quantity), 0);

  return (
    <div className="space-y-4">
      {header}

      <Alert tone="info" title={`Receiving against ${order.reference}`}>
        Outstanding quantity is {qty(totalOutstanding)} across {items.length} line(s). The excess tolerance is{" "}
        {settings.excessReceiptTolerancePercent}% — anything beyond that is refused at posting unless policy says
        otherwise.
      </Alert>

      <ActionForm
        action={createGoodsReceiptAction}
        submitLabel="Save receipt"
        successMessage="Goods receipt saved."
        redirectTo="/procurement/goods-receipts"
      >
        <input type="hidden" name="purchaseOrderId" value={order.id} />
        <input type="hidden" name="receiptDate" value={today()} />

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Delivery</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="supplierDeliveryNoteNumber">Supplier delivery note</Label>
                <Input id="supplierDeliveryNoteNumber" name="supplierDeliveryNoteNumber" placeholder="e.g. DN-4471" />
                <FieldHint>The supplier&apos;s own document number, so the delivery can be matched to their paperwork.</FieldHint>
              </div>
              <div className="space-y-1">
                <Label htmlFor="deliveryReference">Delivery reference</Label>
                <Input id="deliveryReference" name="deliveryReference" placeholder="Waybill or gate entry" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="receiptDate">Receipt date</Label>
                <Input id="receiptDateDisplay" value={formatDate(today())} readOnly disabled />
                <FieldHint>The date the goods were received. It is recorded on the receipt, not on the order.</FieldHint>
              </div>
              <div className="space-y-1">
                <Label htmlFor="warehouseId">Warehouse</Label>
                <Select id="warehouseId" name="warehouseId" required defaultValue={order.delivery_warehouse_id ?? ""}>
                  <option value="">Select the warehouse…</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
                <FieldHint>Where the goods physically went. This is the destination the stock posting will use.</FieldHint>
              </div>
              <div className="space-y-1">
                <Label htmlFor="locationId">Storage location</Label>
                <Select id="locationId" name="locationId" defaultValue={order.delivery_location_id ?? ""}>
                  <option value="">No specific location</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="receivingEmployeeId">Received by</Label>
                <Select id="receivingEmployeeId" name="receivingEmployeeId" defaultValue="">
                  <option value="">Not recorded</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.first_name} {employee.last_name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="vehicleReference">Vehicle</Label>
                <Input id="vehicleReference" name="vehicleReference" placeholder="Plate or truck reference" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="transporterName">Transporter</Label>
                <Input id="transporterName" name="transporterName" placeholder="Who brought the goods" />
              </div>
              <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                <Label htmlFor="observations">Observations</Label>
                <Textarea
                  id="observations"
                  name="observations"
                  rows={2}
                  placeholder="Condition of the delivery, packaging, seal numbers, anything the inspection should know."
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Received lines</CardTitle>
            </CardHeader>
            <CardContent>
              <ReceiptLinesEditor
                lines={items.map((item) => ({
                  id: item.id,
                  line_number: item.line_number,
                  product_description: item.product_description,
                  product_code_snapshot: item.product_code_snapshot,
                  unit_code_snapshot: item.unit_code_snapshot,
                  quantity: Number(item.quantity),
                  received_quantity: Number(item.received_quantity),
                  outstanding_quantity: Number(item.outstanding_quantity),
                  unit_price: Number(item.unit_price),
                }))}
                tolerancePercent={String(settings.excessReceiptTolerancePercent)}
                currencyCode={order.currency_code}
              />
            </CardContent>
          </Card>
        </div>
      </ActionForm>
    </div>
  );
}
