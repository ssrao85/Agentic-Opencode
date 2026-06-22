import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import * as DatabasePath from "../database/path"

export const ManagedWorkspaceTable = sqliteTable(
  "managed_workspace",
  {
    id: text().primaryKey(),
    directory: DatabasePath.absoluteColumn().notNull(),
    name: text(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [uniqueIndex("managed_workspace_directory_idx").on(table.directory)],
)
