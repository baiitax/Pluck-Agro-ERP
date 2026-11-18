#!/usr/bin/env python3
"""Derives TypeScript Row shapes for the Phase 2 and Phase 3 tables straight from the migrations.

The project hand-maintains types/database.types.ts because no hosted Supabase project is linked,
which is fine for a dozen tables and error-prone for forty. This script parses the Phase 2 and
Phase 3 migrations and emits the Row types, so the TypeScript schema cannot drift from the SQL that
created it. Run:  python3 scripts/derive-types-from-migrations.py
"""
import glob
import re

TYPE_MAP = [
    (r'^uuid', 'string'),
    (r'^timestamptz', 'string'),
    (r'^date', 'string'),
    (r'^text', 'string'),
    (r'^boolean', 'boolean'),
    (r'^bigint', 'number'),
    (r'^int', 'number'),
    (r'^numeric', 'number'),
    (r'^jsonb', 'Json'),
]

# Continuation lines of a multi-line CHECK constraint start with `and`/`or`; they are not columns.
SKIP = ('constraint ', 'primary key', 'unique (', 'foreign key', 'check (', 'and ', 'or ')


def map_type(sql_type: str) -> str:
    is_array = sql_type.endswith('[]')
    base = sql_type[:-2] if is_array else sql_type
    for pattern, ts in TYPE_MAP:
        if re.match(pattern, base):
            return f"{ts}[]" if is_array else ts
    raise SystemExit(f"Unmapped SQL type: {sql_type}")


def parse_create_blocks(sql: str):
    for match in re.finditer(r'create table if not exists public\.(\w+)\s*\((.*?)\n\);', sql, re.S):
        table, body = match.group(1), match.group(2)
        columns = []
        for raw_line in body.split("\n"):
            line = raw_line.strip()
            if not line or line.lower().startswith(SKIP):
                continue
            name_match = re.match(r'^([a-z_][a-z0-9_]*)\s+(.+)$', line)
            if not name_match:
                continue
            name, rest = name_match.group(1), name_match.group(2)
            type_match = re.match(r'^([a-z0-9]+(?:\([^)]*\))?(?:\[\])?)', rest)
            if not type_match:
                continue
            ts_type = map_type(type_match.group(1).lower())
            lowered = f' {rest.lower()}'
            # A column with a default or a primary key is never null in a selected row.
            nullable = (
                ' not null' not in lowered
                and 'default' not in lowered
                and 'primary key' not in lowered
            )
            columns.append((name, ts_type, nullable))
        yield table, columns


def main():
    blocks = []
    for path in sorted(
        glob.glob("supabase/migrations/003*.sql")
        + glob.glob("supabase/migrations/004[0-9]_*.sql")
    ):
        with open(path, encoding="utf8") as handle:
            sql = handle.read()
        for table, columns in parse_create_blocks(sql):
            if not columns:
                continue
            body = "\n".join(
                f"        {name}: {ts}{' | null' if nullable else ''};"
                for name, ts, nullable in columns
            )
            blocks.append(f"      {table}: TableDef<{{\n{body}\n      }}>;")

    generated = "\n".join(blocks) + "\n"
    with open("types/master-data.tables.ts.generated", "w", encoding="utf8") as out:
        out.write(generated)

    splice_into_database_types(generated)
    print(f"Derived {len(blocks)} table shapes")


START = "      // <<<generated-tables-start>>> do not edit by hand"
END = "      // <<<generated-tables-end>>>"


def splice_into_database_types(generated: str) -> None:
    """Replaces the marker-delimited block inside `Tables` with the freshly derived shapes.

    Markers make the splice idempotent: re-running the script never duplicates a table, and a table
    removed from the migrations is removed from the TypeScript schema too.
    """
    path = "types/database.types.ts"
    with open(path, encoding="utf8") as handle:
        text = handle.read()

    if START in text and END in text:
        head, rest = text.split(START, 1)
        _, tail = rest.split(END, 1)
        text = f"{head}{START}\n{generated}{END}{tail}"
    else:
        anchor = "    Tables: {\n"
        index = text.index(anchor) + len(anchor)
        text = f"{text[:index]}{START}\n{generated}{END}\n{text[index:]}"

    with open(path, "w", encoding="utf8") as handle:
        handle.write(text)


if __name__ == "__main__":
    main()
