import type { Employee, Profile } from "@/types/database.types";
import type { EffectivePermissions, RoleAssignment } from "@/types/permission.types";

export type SessionUser = {
  id: string;
  email: string;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
};

export type AuthenticatedUser = {
  user: SessionUser;
  profile: Profile;
  employee: Employee | null;
  roles: RoleAssignment[];
  permissions: EffectivePermissions;
};

export type AuthFailureReason =
  | "no_session"
  | "no_profile"
  | "inactive_profile"
  | "pending_account"
  | "sessions_revoked"
  | "inactive_employee"
  | "configuration_error";

export type AuthResolution =
  | { status: "authenticated"; principal: AuthenticatedUser }
  | { status: "unauthenticated"; reason: AuthFailureReason; message: string };
