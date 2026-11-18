import Link from "next/link";
import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { groupedPermissions } from "@/lib/permissions/definitions";

export type MatrixRole = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  grants: Map<string, string>;
};

/**
 * Role × permission matrix.
 *
 * Read-only by design: changes are made on the role page, where each change carries a
 * justification and is audited. The matrix exists to answer "who can do this?" quickly.
 */
export function PermissionsMatrix({ roles }: { roles: MatrixRole[] }) {
  const groups = groupedPermissions();

  return (
    <TableWrapper>
      <Table className="min-w-[64rem]">
        <THead>
          <TR className="hover:bg-transparent">
            <TH className="sticky left-0 bg-surface">Permission</TH>
            {roles.map((role) => (
              <TH key={role.id} className="text-center">
                <Link href={`/administration/roles/${role.id}`} className="hover:text-brand-700 hover:underline">
                  {role.name}
                </Link>
                {role.is_active ? null : (
                  <Badge tone="neutral" className="ml-1 text-[0.5625rem]">
                    off
                  </Badge>
                )}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {groups.map((group) => (
            <>
              <TR key={`${group.module}.${group.resource}-header`} className="bg-surface-sunken hover:bg-surface-sunken">
                <TD colSpan={roles.length + 1} className="text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-muted">
                  {group.module} · {group.resource}
                </TD>
              </TR>
              {group.codes.map((code) => (
                <TR key={code}>
                  <TD className="sticky left-0 bg-surface font-mono text-[0.6875rem] text-ink">
                    {code}
                    <span className="ml-1 text-ink-subtle">{group.codes.length > 0 ? "" : ""}</span>
                  </TD>
                  {roles.map((role) => {
                    const scope = role.grants.get(code);
                    return (
                      <TD key={`${role.id}-${code}`} className="text-center">
                        {scope ? (
                          scope === "GLOBAL" ? (
                            <Check className="mx-auto size-3.5 text-success-600" aria-label="Granted" />
                          ) : (
                            <Badge tone="info" className="text-[0.5625rem]">
                              {scope.replace(/_/g, " ")}
                            </Badge>
                          )
                        ) : (
                          <span className="text-ink-subtle" aria-label="Not granted">
                            ·
                          </span>
                        )}
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </>
          ))}
        </TBody>
      </Table>
    </TableWrapper>
  );
}
