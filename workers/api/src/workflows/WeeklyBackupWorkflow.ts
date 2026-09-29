import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Env } from '../types';
import { getDb } from '../services/db';

export class WeeklyBackupWorkflow extends WorkflowEntrypoint<Env, Record<string, unknown>> {
  async run(event: WorkflowEvent<Record<string, unknown>>, step: WorkflowStep) {
    const today = new Date().toISOString().slice(0, 10);

    const tables = ['orders', 'drivers', 'riders', 'regional_cities', 'ledger_entries'];
    const summary: Record<string, number> = {};

    const endpoint = this.env.S3_ENDPOINT || this.env.AWS_ENDPOINT_URL_S3;
    const accessKeyId = this.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = this.env.AWS_SECRET_ACCESS_KEY;
    const s3 = (endpoint && accessKeyId && secretAccessKey)
      ? new S3Client({
          endpoint,
          region: this.env.S3_REGION || this.env.AWS_REGION || 'us-east-2',
          credentials: { accessKeyId, secretAccessKey },
          forcePathStyle: true,
        })
      : null;

    for (const table of tables) {
      const rowCount = await step.do(`backup-${table}`, async () => {
        const sql = getDb(this.env);
        // Query rows as JSON
        const rows = await sql`SELECT * FROM ${sql(table)} LIMIT 50000`;
        const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');
        const backupKey = `backups/${today}/${table}.jsonl`;

        if (s3) {
          const bucket = this.env.S3_BUCKET || 'uploads';
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: backupKey,
              Body: jsonl,
              ContentType: 'application/x-ndjson',
            })
          );
        } else if (this.env.DOCS) {
          await this.env.DOCS.put(backupKey, jsonl, {
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
