"use client";

/**
 * The procurement workspace's form primitives now live in `components/shared/action-form` so the
 * inventory and production workspaces can use the same behaviour. This file stays as the import
 * path procurement already uses, so there is exactly one implementation.
 */
export { ActionForm, ActionButton } from "@/components/shared/action-form";
