import { Hono } from 'hono';
import { z } from 'zod';
import { getCollection } from '../services/mongo';

function flattenQueries(params: Record<string, string[]>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, value[value.length - 1]])
  );
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).max(1_000).default(0),
  q: z.string().min(1).max(128).optional(),
  collection: z.string().min(1).max(128).optional(),
});

const gatewayQuerySchema = z.object({
  collection: z.string().min(1).max(128).optional(),
  filter: z.record(z.unknown()).default({}),
  projection: z.record(z.unknown()).optional(),
  sort: z.record(z.unknown()).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  skip: z.number().int().min(0).max(1_000).default(0),
});

export const recordsRoute = new Hono();

recordsRoute.get('/', async (c) => {
  const parsed = listQuerySchema.safeParse(flattenQueries(c.req.queries()));
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', issues: parsed.error.flatten() }, 400);
  }

  const { limit, skip, q, collection } = parsed.data;
  const col = await getCollection(collection);
  const filter = q ? { $text: { $search: q } } : {};

  const results = await col
    .find(filter)
    .skip(skip)
    .limit(limit)
    .toArray();

  return c.json({
    data: results,
    meta: {
      limit,
      skip,
      count: results.length,
    },
  });
});

recordsRoute.post('/query', async (c) => {
  const body = await c.req.json();
  const parsed = gatewayQuerySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', issues: parsed.error.flatten() }, 400);
  }

  const { collection, filter, projection, sort, skip, limit } = parsed.data;
  const col = await getCollection(collection);

  const cursor = col.find(filter, { projection }).skip(skip).limit(limit);
  if (sort) {
    cursor.sort(sort as Record<string, 1 | -1>);
  }

  const results = await cursor.toArray();

  return c.json({
    data: results,
    meta: {
      limit,
      skip,
      count: results.length,
    },
  });
});
