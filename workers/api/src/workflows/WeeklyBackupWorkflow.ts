import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../types';
import { getDb } from '../services/db';

export class WeeklyBackupWorkflow extends WorkflowEntrypoint<Env, Record<string, unknown>> {
  async run(event: WorkflowEvent<Record<string, unknown>>, step: WorkflowStep) {
    const today = new Date().toISOString().slice(0, 10);

    const tables = ['orders', 'drivers', 'riders', 'regional_cities', 'ledger_entries'];
    const summary: Record<string, number> = {};

    for (const table of tables) {
      const rowCount = await step.do(`backup-${table}`, async () => {
        const sql = getDb(this.env);
        // Query rows as JSON
        const rows = await sql`SELECT * FROM ${sql(table)} LIMIT 50000`;
        const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');

        if (this.env.DOCS) {
          await this.env.DOCS.put(`backups/${today}/${table}.jsonl`, jsonl, {
            httpMetadata: { contentType: 'application/x-ndjson' },
          });
        }
        return rows.length;
      });
      summary[table] = rowCount;
    }

    return { backupDate: today, summary };
  }
}
