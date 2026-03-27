import pg from './node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://synapse:12345678@localhost:5432/spec2flow' });

const RUN_ID = 'synapse-network-workflow-1774578809552';

const r1 = await pool.query(
  `UPDATE public.tasks SET status = 'ready', updated_at = NOW()
   WHERE run_id = $1 AND status = 'pending'
     AND task_id = 'docs-governance--requirements-analysis'
   RETURNING task_id, status`,
  [RUN_ID]
);
console.log('docs-governance req ready:', r1.rows);

const r2 = await pool.query(
  `UPDATE public.tasks SET status = 'ready', updated_at = NOW()
   WHERE run_id = $1 AND status = 'pending'
     AND task_id = ANY($2::text[])
   RETURNING task_id, status`,
  [RUN_ID, ['provider-registration-flow--requirements-analysis', 'gateway-api-smoke--requirements-analysis']]
);
console.log('other routes ready:', r2.rows);

const r3 = await pool.query(
  `SELECT task_id, status FROM public.tasks WHERE run_id = $1 ORDER BY task_id`,
  [RUN_ID]
);
console.log('all tasks:\n' + r3.rows.map(r => `  ${r.task_id}: ${r.status}`).join('\n'));

await pool.end();
