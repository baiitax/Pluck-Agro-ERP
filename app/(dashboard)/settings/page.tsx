import type { Metadata } from "next";
import { Info, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { APP_CONFIG } from "@/config/app.config";
import { formatDateTime } from "@/lib/formatting";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";
import { getSystemHealth } from "@/services/system/health-check";
import type { SystemSetting } from "@/types/database.types";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const principal = await requirePermission("settings.system.view");
  const supabase = await createSupabaseServerClient();

  // RLS limits this to non-sensitive rows and to accounts with settings.view.
  const { data: settings } = await supabase
    .from("system_settings")
    .select("*")
    .order("setting_key")
    .returns<SystemSetting[]>();

  const health = await getSystemHealth();

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Read-only view of application configuration recorded in the database. Sensitive values are never stored here."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Settings" }]}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>System settings</CardTitle>
              <CardDescription>Non-secret configuration rows</CardDescription>
            </div>
            <Badge tone="neutral">{settings?.length ?? 0} keys</Badge>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {!settings || settings.length === 0 ? (
              <p className="px-5 pb-5 text-xs text-ink-muted">
                No settings are visible to your account. Row Level Security hides rows your role cannot read.
              </p>
            ) : (
              <TableWrapper>
                <Table className="min-w-[32rem]">
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Key</TH>
                      <TH>Value</TH>
                      <TH>Updated</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {settings.map((setting) => (
                      <TR key={setting.id}>
                        <TD className="font-mono text-[0.6875rem] text-ink">{setting.setting_key}</TD>
                        <TD className="text-xs text-ink-muted">
                          {setting.setting_value === null ? "—" : JSON.stringify(setting.setting_value)}
                        </TD>
                        <TD className="text-[0.6875rem] text-ink-subtle">{formatDateTime(setting.updated_at)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Application</CardTitle>
                <CardDescription>Build information</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              <Row label="Product" value={APP_CONFIG.name} />
              <Row label="Organisation" value={APP_CONFIG.organisation} />
              <Row label="Version" value={APP_CONFIG.version} />
              <Row label="Phase" value={APP_CONFIG.phase} />
              <Row label="Database" value={health.checks.database} />
              <Row label="Environment" value={health.checks.environment} />
            </CardContent>
          </Card>

          <Alert tone="info" title="Editing settings is not yet available">
            Configuration changes will be delivered with the settings administration screens. Secrets and
            service credentials belong in environment variables, never in this table.
          </Alert>

          {!principal.permissions.has("settings.system.manage") ? (
            <Alert tone="warning" title="Read-only">
              <span className="flex items-start gap-1.5">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Your role does not include settings.manage.
              </span>
            </Alert>
          ) : null}
        </div>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[0.6875rem] text-ink-subtle">
        <Info className="size-3.5" aria-hidden />
        Settings marked sensitive are excluded by Row Level Security and are not rendered here.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-1">
      <span className="text-ink-muted">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}
