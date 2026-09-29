import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../types';
import { getDb } from '../services/db';

export class DocExpiryWorkflow extends WorkflowEntrypoint<Env, Record<string, unknown>> {
  async run(event: WorkflowEvent<Record<string, unknown>>, step: WorkflowStep) {
    const expiredDrivers = await step.do('find-expiring-documents', async () => {
      const sql = getDb(this.env, { write: true });
      return await sql<{ driver_id: string; document_type: string; expires_at: string }[]>`
        SELECT driver_id, document_type, expires_at
        FROM driver_documents
        WHERE expires_at IS NOT NULL
          AND expires_at < NOW() + INTERVAL '7 days'
          AND status = 'APPROVED'
      `;
    });

    if (expiredDrivers.length === 0) return { notifiedCount: 0 };

    const notified = await step.do('send-expiry-warnings', async () => {
      const sql = getDb(this.env, { write: true });
      let count = 0;
      for (const d of expiredDrivers) {
        await sql`
          INSERT INTO notification_outbox (recipient_id, recipient_type, title, body, payload, status)
          VALUES (
            ${d.driver_id},
            'DRIVER',
            'Document Expiring Soon',
            ${`Your ${d.document_type} is expiring on ${new Date(d.expires_at).toLocaleDateString()}. Please upload a renewed copy.`},
            ${JSON.stringify({ type: 'doc_expiry_warning', document_type: d.document_type })},
            'PENDING'
          )
        `;
        count++;
      }
      return count;
    });

    return { notifiedCount: notified };
  }
}
