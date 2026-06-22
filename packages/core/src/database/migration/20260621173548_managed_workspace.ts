import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260621173548_managed_workspace",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`managed_workspace\` (
          \`id\` text PRIMARY KEY,
          \`directory\` text NOT NULL,
          \`name\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE UNIQUE INDEX \`managed_workspace_directory_idx\` ON \`managed_workspace\` (\`directory\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
