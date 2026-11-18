import type { PermissionCode } from "@/lib/permissions/definitions";
import type { ModuleStatus } from "@/types/common.types";

export type NavIconKey =
  | "dashboard"
  | "employees"
  | "departments"
  | "users"
  | "roles"
  | "permissions"
  | "positions"
  | "orgchart"
  | "governance"
  | "delegation"
  | "sod"
  | "review"
  | "audit"
  | "settings"
  | "procurement"
  | "production"
  | "inventory"
  | "quality"
  | "sales"
  | "dispatch"
  | "export"
  | "finance"
  | "expenses"
  | "treasury"
  | "assets"
  | "reports"
  | "approvals"
  | "documents"
  | "notifications"
  | "masterdata";

export type NavItem = {
  label: string;
  href: string;
  icon: NavIconKey;
  permission: PermissionCode;
  status: ModuleStatus;
  /** Short note shown in the UI when a module is not yet implemented. */
  note?: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAVIGATION: NavGroup[] = [
  {
    label: "Master data",
    items: [
      {
        label: "Master data",
        href: "/master-data",
        icon: "masterdata",
        permission: "master_data.overview.view",
        status: "ready",
      },
      {
        label: "Suppliers",
        href: "/master-data/suppliers",
        icon: "procurement",
        permission: "master_data.suppliers.view",
        status: "ready",
      },
      {
        label: "Customers",
        href: "/master-data/customers",
        icon: "users",
        permission: "master_data.customers.view",
        status: "ready",
      },
      {
        label: "Product catalogue",
        href: "/master-data/products",
        icon: "inventory",
        permission: "master_data.products.view",
        status: "ready",
      },
      {
        label: "Units & conversions",
        href: "/master-data/units",
        icon: "quality",
        permission: "master_data.units.view",
        status: "ready",
      },
      {
        label: "Imports",
        href: "/master-data/imports",
        icon: "documents",
        permission: "master_data.imports.view",
        status: "ready",
      },
    ],
  },
  {
    label: "Overview",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: "dashboard",
        permission: "dashboard.overview.view",
        status: "ready",
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        label: "Employees",
        href: "/administration/employees",
        icon: "employees",
        permission: "employees.employee.view",
        status: "ready",
      },
      {
        label: "Departments",
        href: "/administration/departments",
        icon: "departments",
        permission: "employees.department.view",
        status: "ready",
      },
      {
        label: "Positions",
        href: "/administration/positions",
        icon: "positions",
        permission: "employees.position.view",
        status: "ready",
      },
      {
        label: "Org chart",
        href: "/administration/org-chart",
        icon: "orgchart",
        permission: "employees.department.view",
        status: "ready",
      },
      {
        label: "Users & Access",
        href: "/administration/users",
        icon: "users",
        permission: "access.accounts.view",
        status: "ready",
      },
      {
        label: "Roles",
        href: "/administration/roles",
        icon: "roles",
        permission: "access.roles.view",
        status: "ready",
      },
      {
        label: "Permission matrix",
        href: "/administration/permissions",
        icon: "permissions",
        permission: "access.permissions.view",
        status: "ready",
      },
      {
        label: "Settings",
        href: "/settings",
        icon: "settings",
        permission: "settings.system.view",
        status: "ready",
      },
    ],
  },
  {
    label: "Governance",
    items: [
      {
        label: "Governance dashboard",
        href: "/governance",
        icon: "governance",
        permission: "governance.approvals.view",
        status: "ready",
      },
      {
        label: "Approval authorities",
        href: "/governance/authorities",
        icon: "approvals",
        permission: "governance.approvals.view",
        status: "ready",
      },
      {
        label: "Delegations",
        href: "/governance/delegations",
        icon: "delegation",
        permission: "governance.delegations.view",
        status: "ready",
      },
      {
        label: "Segregation of duties",
        href: "/governance/sod",
        icon: "sod",
        permission: "governance.sod.view",
        status: "ready",
      },
      {
        label: "Access reviews",
        href: "/governance/access-reviews",
        icon: "review",
        permission: "governance.reviews.view",
        status: "ready",
      },
      {
        label: "Audit trail",
        href: "/audit-logs",
        icon: "audit",
        permission: "governance.audit.view",
        status: "ready",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        label: "Procurement",
        href: "/procurement",
        icon: "procurement",
        permission: "procurement.purchase_order.view",
        status: "ready",
      },
      {
        label: "Production",
        href: "/production",
        icon: "production",
        permission: "production.batch.view",
        status: "ready",
      },
      {
        label: "Inventory",
        href: "/inventory",
        icon: "inventory",
        permission: "inventory.stock.view",
        status: "ready",
      },
      {
        label: "Quality Control",
        href: "/quality",
        icon: "quality",
        permission: "quality.inspection.view",
        status: "ready",
      },
    ],
  },
  {
    label: "Commercial",
    items: [
      {
        label: "Sales",
        href: "/sales",
        icon: "sales",
        permission: "sales.order.view",
        status: "planned",
      },
      {
        label: "Dispatch",
        href: "/dispatch",
        icon: "dispatch",
        permission: "dispatch.dispatch.view",
        status: "planned",
      },
      {
        label: "Export",
        href: "/export",
        icon: "export",
        permission: "export.shipment.view",
        status: "planned",
      },
    ],
  },
  {
    label: "Finance",
    items: [
      {
        label: "Finance & Accounting",
        href: "/finance",
        icon: "finance",
        permission: "finance.journal.view",
        status: "planned",
      },
      {
        label: "Expenses & Imprest",
        href: "/expenses",
        icon: "expenses",
        permission: "expenses.expense.view",
        status: "planned",
      },
      {
        label: "Treasury & Banking",
        href: "/treasury",
        icon: "treasury",
        permission: "treasury.payment.view",
        status: "planned",
      },
      {
        label: "Assets & Investments",
        href: "/assets",
        icon: "assets",
        permission: "assets.asset.view",
        status: "planned",
      },
      {
        label: "Reports",
        href: "/reports",
        icon: "reports",
        permission: "reports.report.view",
        status: "planned",
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      {
        label: "Approvals",
        href: "/approvals",
        icon: "approvals",
        permission: "approvals.queue.view",
        status: "planned",
        note: "The workflow and approval engine lands in a later phase.",
      },
      {
        label: "Documents",
        href: "/documents",
        icon: "documents",
        permission: "documents.document.view",
        status: "planned",
      },
      {
        label: "Notifications",
        href: "/notifications",
        icon: "notifications",
        permission: "dashboard.overview.view",
        status: "planned",
      },
    ],
  },
];

export const PLANNED_MODULE_ROUTES = NAVIGATION.flatMap((group) => group.items)
  .filter((item) => item.status === "planned")
  .map((item) => item.href);
