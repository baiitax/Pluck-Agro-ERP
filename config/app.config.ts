export const APP_CONFIG = {
  name: "Pluck Agro ERP",
  shortName: "Pluck ERP",
  organisation: "Pluck Agro Allied",
  version: "0.1.0",
  phase: "Phase 5 — Quality Management",
  description:
    "Integrated enterprise resource planning platform for Pluck Agro Allied procurement, production, inventory, sales, export and finance operations.",
  supportEmail: "support@pluckagro.example",
  defaultPageSize: 20,
  pageSizeOptions: [10, 20, 50, 100],
} as const;

export const THEME = {
  storageKey: "pluck-erp-theme",
  default: "light",
} as const;
