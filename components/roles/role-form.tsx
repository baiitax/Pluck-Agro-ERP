"use client";

import * as React from "react";

import { Copy, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useServerForm } from "@/components/forms/use-server-form";
import { ROLE_CATEGORIES, ROLE_CATEGORY_LABELS } from "@/lib/validation/role.schemas";
import {
  cloneRoleAction,
  createRoleAction,
  deleteRoleAction,
  updateRoleAction,
} from "@/app/(dashboard)/administration/roles/actions";

export type RoleFormValues = {
  id: string;
  name: string;
  code: string;
  category: string;
  description: string | null;
  is_active: boolean;
  is_system_role: boolean;
};

export function CreateRoleDialog() {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(createRoleAction, (result) => {
    if (result.ok) {
      toast.success("Role created.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });
  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> New role
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create a role"
        description="New roles start with no permissions. Grant permissions in the matrix afterwards, then assign the role."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="create-role-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Create role
            </Button>
          </>
        }
      >
        <form id="create-role-form" action={run} className="space-y-3" noValidate>
          {state && !state.ok ? <Alert tone="danger" title="Could not create">{state.error.message}</Alert> : null}
          <div className="space-y-1">
            <Label htmlFor="role-name">Name *</Label>
            <Input id="role-name" name="name" required />
            <FieldError message={fieldErrors.name?.[0]} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-code">Code</Label>
            <Input id="role-code" name="code" placeholder="Optional — derived from the name" />
            <FieldHint>Lowercase letters, numbers and underscores. Codes cannot be changed later.</FieldHint>
            <FieldError message={fieldErrors.code?.[0]} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-category">Category</Label>
            <Select id="role-category" name="category" defaultValue="custom">
              {ROLE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {ROLE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-description">Description</Label>
            <Textarea id="role-description" name="description" rows={2} />
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function EditRoleDialog({ role }: { role: RoleFormValues }) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(updateRoleAction, (result) => {
    if (result.ok) {
      toast.success("Role updated.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });
  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pencil aria-hidden /> Edit role
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Edit ${role.name}`}
        description={role.is_system_role ? "System role: the code cannot change and the role cannot be deleted." : "Role details. Permission grants are edited in the matrix."}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="edit-role-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Save changes
            </Button>
          </>
        }
      >
        <form id="edit-role-form" action={run} className="space-y-3" noValidate>
          <input type="hidden" name="id" value={role.id} />
          {state && !state.ok ? <Alert tone="danger" title="Could not save">{state.error.message}</Alert> : null}
          <div className="space-y-1">
            <Label htmlFor="edit-role-name">Name *</Label>
            <Input id="edit-role-name" name="name" required defaultValue={role.name} />
            <FieldError message={fieldErrors.name?.[0]} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-role-code">Code</Label>
            <Input id="edit-role-code" value={role.code} disabled readOnly />
            <FieldHint>Role codes are immutable so audit records stay meaningful.</FieldHint>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-role-category">Category</Label>
            <Select id="edit-role-category" name="category" defaultValue={role.category}>
              {ROLE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {ROLE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-role-active">Status</Label>
            <Select id="edit-role-active" name="isActive" defaultValue={role.is_active ? "true" : "false"}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
            <FieldHint>An inactive role grants nothing to its members.</FieldHint>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-role-description">Description</Label>
            <Textarea id="edit-role-description" name="description" rows={2} defaultValue={role.description ?? ""} />
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function CloneRoleDialog({ role }: { role: RoleFormValues }) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(cloneRoleAction, (result) => {
    if (result.ok) {
      toast.success("Role cloned. Adjust its permissions in the matrix.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });
  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Copy aria-hidden /> Clone
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Clone ${role.name}`}
        description="Cloning copies every permission grant into a new custom role. Use it as the safe way to create a variant of a system role."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="clone-role-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Clone role
            </Button>
          </>
        }
      >
        <form id="clone-role-form" action={run} className="space-y-3" noValidate>
          <input type="hidden" name="sourceRoleId" value={role.id} />
          {state && !state.ok ? <Alert tone="danger" title="Could not clone">{state.error.message}</Alert> : null}
          <div className="space-y-1">
            <Label htmlFor="clone-name">New name *</Label>
            <Input id="clone-name" name="name" required defaultValue={`${role.name} (copy)`} />
            <FieldError message={fieldErrors.name?.[0]} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="clone-code">New code *</Label>
            <Input id="clone-code" name="code" required defaultValue={`${role.code}_copy`} />
            <FieldHint>Lowercase letters, numbers and underscores.</FieldHint>
            <FieldError message={fieldErrors.code?.[0]} />
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function DeleteRoleButton({ roleId, name, disabled }: { roleId: string; name: string; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(deleteRoleAction, (result) => {
    if (result.ok) {
      toast.success("Role deleted.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} disabled={disabled}>
        <Trash2 aria-hidden /> Delete
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete ${name}?`}
        description="Deletion is refused for system roles and for any role with active members. Deactivate those instead."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" type="submit" form="delete-role-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Delete role
            </Button>
          </>
        }
      >
        <form id="delete-role-form" action={run} className="space-y-3">
          <input type="hidden" name="id" value={roleId} />
          {state && !state.ok ? <Alert tone="danger" title="Could not delete">{state.error.message}</Alert> : null}
          <div className="space-y-1">
            <Label htmlFor="delete-role-reason">Reason *</Label>
            <Textarea id="delete-role-reason" name="reason" rows={2} required minLength={10} />
          </div>
        </form>
      </Dialog>
    </>
  );
}
