const { z } = require('zod');

let cached;

const schema = z.object({
  NODE_ENV: z.string().optional().default('development'),
  DEPLOYMENT_MODE: z.string().optional().default('development'),
  PORT: z.coerce.number().int().positive().optional().default(3000),
  DATABASE_URL: z.string().url().nonempty(),
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
