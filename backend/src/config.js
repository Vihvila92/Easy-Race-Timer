const { z } = require('zod');

let cached;

// In unit test mode (no DATABASE_URL) we allow it to be absent so modules can load.
const dbUrlSchema = process.env.JEST_INT === '1'
  ? z.string().url().nonempty()
  : z.string().url().nonempty().optional();

const schema = z.object({
  NODE_ENV: z.string().optional().default('development'),
  DEPLOYMENT_MODE: z.string().optional().default('development'),
  PORT: z.coerce.number().int().positive().optional().default(3000),
  DATABASE_URL: dbUrlSchema,
  LOG_LEVEL: z.enum(['debug','info','warn','error']).optional().default('info')
});

function loadConfig() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`Invalid configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

module.exports = { loadConfig };
