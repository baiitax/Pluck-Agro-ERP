/**
 * Builds organisation trees from flat rows.
 *
 * Used by the department hierarchy view and the org chart. Pure and cycle-safe: a malformed
 * parent link can never hang the render, because visited nodes are tracked.
 */

export type TreeNode<T> = {
  node: T;
  children: TreeNode<T>[];
  depth: number;
};

export type Treeable = { id: string; parentId: string | null };

export function buildTree<T extends Treeable>(rows: T[]): TreeNode<T>[] {
  const byParent = new Map<string | null, T[]>();
  for (const row of rows) {
    const key = row.parentId;
    const bucket = byParent.get(key) ?? [];
    bucket.push(row);
    byParent.set(key, bucket);
  }

  const roots = byParent.get(null) ?? [];
  const visited = new Set<string>();

  const attach = (row: T, depth: number): TreeNode<T> => {
    visited.add(row.id);
    const children = (byParent.get(row.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .map((child) => attach(child, depth + 1));
    return { node: row, children, depth };
  };

  const tree = roots.map((root) => attach(root, 0));

  // Orphaned rows (parent missing or part of a cycle) are surfaced as roots rather than lost.
  for (const row of rows) {
    if (!visited.has(row.id)) tree.push(attach(row, 0));
  }

  return tree;
}

export function flattenTree<T>(tree: TreeNode<T>[]): TreeNode<T>[] {
  const output: TreeNode<T>[] = [];
  const walk = (nodes: TreeNode<T>[]) => {
    for (const node of nodes) {
      output.push(node);
      walk(node.children);
    }
  };
  walk(tree);
  return output;
}

export function findNode<T extends { id: string }>(tree: TreeNode<T>[], id: string): TreeNode<T> | null {
  for (const node of tree) {
    if (node.node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** Ids of a node and all of its descendants — used to forbid "move under my own child". */
export function descendantIds<T extends { id: string }>(tree: TreeNode<T>[], id: string): string[] {
  const node = findNode(tree, id);
  if (!node) return [];
  return flattenTree(node.children).map((child) => child.node.id);
}
