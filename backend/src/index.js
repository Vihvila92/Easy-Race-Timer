const express = require('express');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const { orgContextMiddleware } = require('./middleware/orgContext.js');
const { requestIdMiddleware } = require('./middleware/requestId');
const { loggingMiddleware } = require('./middleware/logging');
const { loadConfig } = require('./config');
const { competitionsRouter } = require('./routes/competitions');
const { competitorsRouter } = require('./routes/competitors');
const { entriesRouter } = require('./routes/entries');
const { authRouter } = require('./routes/auth');
const { authMiddleware } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

// Set up rate limiter: maximum of 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

dotenv.config({ path: '../.env' });

const app = express();
app.use(express.json());
app.use(requestIdMiddleware);
app.use(orgContextMiddleware); // header x-org-id (legacy / tests)
app.use(limiter); // Apply rate limiting before authMiddleware
app.use(authMiddleware); // JWT sets req.user + orgId override
app.use(loggingMiddleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/competitions', competitionsRouter);
app.use('/competitors', competitorsRouter);
app.use('/auth', authRouter);
app.use('/', entriesRouter);
app.use(errorHandler);

const { PORT: port } = loadConfig();
function start() {
  return app.listen(port, () => console.log(`API listening on ${port}`));
}

module.exports = { default: app, start };
