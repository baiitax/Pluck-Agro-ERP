import type { PermissionCode } from "@/lib/permissions/definitions";

export type EffectivePermissions = ReadonlySet<PermissionCode>;

export type PermissionCheck =
  | { allowed: true }
  | { allowed: false; missing: PermissionCode };

export type RoleAssignment = {
  id: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  assignedAt: string;
  assignedBy: string | null;
  expiresAt: string | null;
  isActive: boolean;
};
