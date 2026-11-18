"use client";

import * as React from "react";

import { Loader2, Save, Search } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { useServerForm } from "@/components/forms/use-server-form";
import { groupedPermissions, PERMISSION_SCOPES } from "@/lib/permissions/definitions";
import { updateRolePermissionsAction } from "@/app/(dashboard)/administration/roles/actions";

type GrantState = Record<string, string>;

/**
 * Role → permission editor.
 *
 * The whole catalogue is shown grouped by module and resource. Scope is part of each grant, so
 * a department-scoped grant is visibly different from a global one. Nothing is saved until the
 * justification is provided, because every change is a privileged action.
 */
export function PermissionMatrixEditor({
  roleId,
  roleName,
  permissions,
  initialGrants,
  currentUserPermissions,
  readOnlyReason,
}: {
  roleId: string;
  roleName: string;
  permissions: { id: string; code: string }[];
  initialGrants: { code: string; scopeType: string }[];
  currentUserPermissions: string[];
  readOnlyReason?: string;
}) {
  const [grants, setGrants] = React.useState<GrantState>(() =>
    Object.fromEntries(initialGrants.map((grant) => [grant.code, grant.scopeType])),
  );
  const [filter, setFilter] = React.useState("");
  const [dirty, setDirty] = React.useState(false);

  const { state, isPending, run } = useServerForm(updateRolePermissionsAction, (result) => {
    if (result.ok) {
      toast.success(`Permissions saved (+${result.data.added} / -${result.data.removed}).`);
      setDirty(false);
    } else {
      toast.error(result.error.message);
    }
  });

  const groups = React.useMemo(() => groupedPermissions(), []);
  const permissionIdByCode = React.useMemo(
    () => new Map(permissions.map((permission) => [permission.code, permission.id])),
    [permissions],
  );
  const term = filter.trim().toLowerCase();
  const heldByActor = React.useMemo(() => new Set(currentUserPermissions), [currentUserPermissions]);

  const toggle = (code: string) => {
    if (readOnlyReason) return;
    setGrants((current) => {
      const next = { ...current };
      if (next[code]) delete next[code];
      else next[code] = "GLOBAL";
      return next;
    });
    setDirty(true);
  };

  const setScope = (code: string, scope: string) => {
    if (readOnlyReason) return;
    setGrants((current) => ({ ...current, [code]: scope }));
    setDirty(true);
  };

  const grantCount = Object.keys(grants).length;

  return (
    <div className="space-y-4">
      {readOnlyReason ? (
        <Alert tone="warning" title="Read-only">
          {readOnlyReason}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter permissions…"
            className="h-8 w-64 pl-8 text-xs"
            aria-label="Filter permissions"
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="info">{grantCount} granted</Badge>
          <Button variant="secondary" size="sm" onClick={() => setGrants({})} disabled={Boolean(readOnlyReason) || grantCount === 0}>
            Clear all
          </Button>
        </div>
      </div>

      <form
        action={run}
        className="space-y-4"
        // The grants travel as JSON so one request replaces the whole set atomically.
      >
        <input type="hidden" name="roleId" value={roleId} />
        <input
          type="hidden"
          name="grants"
          value={JSON.stringify(Object.entries(grants).map(([code, scopeType]) => ({
            permissionId: permissionIdByCode.get(code) ?? code,
            scopeType,
          })).filter((grant) => grant.permissionId))}
        />

        <div className="space-y-3">
          {groups.map((group) => {
            const codes = group.codes.filter((code) => !term || code.toLowerCase().includes(term));
            if (codes.length === 0) return null;
            return (
              <div key={`${group.module}.${group.resource}`} className="rounded-md border border-border">
                <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-sunken px-3 py-1.5">
                  <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-muted">
                    {group.module} · {group.resource}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(readOnlyReason)}
                    onClick={() => {
                      setGrants((current) => {
                        const next = { ...current };
                        const allGranted = codes.every((code) => next[code]);
                        for (const code of codes) {
                          if (allGranted) delete next[code];
                          else next[code] = next[code] ?? "GLOBAL";
                        }
                        return next;
                      });
                      setDirty(true);
                    }}
                  >
                    {codes.every((code) => grants[code]) ? "Clear group" : "Grant group"}
                  </Button>
                </div>
                <ul className="divide-y divide-border/60">
                  {codes.map((code) => {
                    const granted = Boolean(grants[code]);
                    const beyondActor = !heldByActor.has(code);
                    return (
                      <li key={code} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={granted}
                            onChange={() => toggle(code)}
                            disabled={Boolean(readOnlyReason)}
                            className="size-3.5 rounded border-border-strong"
                          />
                          <span className={granted ? "font-medium text-ink" : "text-ink-muted"}>{code}</span>
                          {beyondActor ? (
                            <Badge tone="pending" className="text-[0.625rem]">
                              beyond your own access
                            </Badge>
                          ) : null}
                        </label>
                        <Select
                          value={grants[code] ?? "GLOBAL"}
                          onChange={(event) => setScope(code, event.target.value)}
                          disabled={!granted || Boolean(readOnlyReason)}
                          aria-label={`Scope for ${code}`}
                          className="h-7 w-40 text-[0.6875rem]"
                        >
                          {PERMISSION_SCOPES.map((scope) => (
                            <option key={scope} value={scope}>
                              {scope.replace(/_/g, " ")}
                            </option>
                          ))}
                        </Select>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        {!readOnlyReason ? (
          <div className="space-y-2 rounded-md border border-border bg-surface-sunken p-3">
            {state && !state.ok ? (
              <Alert tone="danger" title="Could not save permissions">
                {state.error.message}
              </Alert>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="permission-change-reason">Justification *</Label>
              <Textarea
                id="permission-change-reason"
                name="reason"
                rows={2}
                required
                minLength={10}
                placeholder="Why does this role need these permissions?"
              />
            </div>
            <Button type="submit" size="sm" disabled={isPending || !dirty}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              Save permissions for {roleName}
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
