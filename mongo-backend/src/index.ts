import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { closeMongo, getDatabase } from './services/mongo';
import { recordsRoute } from './routes/records';

const app = new Hono();

app.use('*', logger());
app.use('*', cors());

app.get('/health', async (c) => {
  try {
    const db = await getDatabase();
    await db.command({ ping: 1 });
    return c.json({ ok: true, mongo: 'reachable' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, mongo: message }, 503);
  }
});

app.route('/records', recordsRoute);

const port = Number(process.env.PORT ?? 8787);

const server = serve({
  fetch: app.fetch,
  port,
});

console.log(`🚀 Hono server ready on http://localhost:${port}`);

const shutdown = async () => {
  console.log('Received shutdown signal. Closing Mongo connection...');
  await closeMongo();
  server.close(() => {
    console.log('Server stopped gracefully.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
