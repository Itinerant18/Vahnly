import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../types';
import { getDb } from '../services/db';

export class PayoutBatchWorkflow extends WorkflowEntrypoint<Env, { batchId?: string }> {
  async run(event: WorkflowEvent<{ batchId?: string }>, step: WorkflowStep) {
    const batchId = event.payload.batchId || crypto.randomUUID();

    // Step 1: Find pending payout requests
    const pending = await step.do('fetch-pending-payouts', async () => {
      const sql = getDb(this.env, { write: true });
      return await sql<{ id: string; driver_id: string; amount_paise: number }[]>`
        SELECT id, driver_id, amount_paise
        FROM driver_payouts
        WHERE status = 'REQUESTED'
        LIMIT 50
      `;
    });

    if (pending.length === 0) return { settledCount: 0 };

    // Step 2: Settle payouts
    const settled = await step.do('settle-payouts', async () => {
      const sql = getDb(this.env, { write: true });
      let count = 0;
      for (const p of pending) {
        await sql`
          UPDATE driver_payouts
          SET status = 'COMPLETED',
              settled_at = now(),
              batch_reference = ${batchId}
          WHERE id = ${p.id}::uuid
        `;
        count++;
      }
      return count;
    });

    return { batchId, settledCount: settled };
  }
}
