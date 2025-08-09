const express = require('express');
const dotenv = require('dotenv');
const { orgContextMiddleware } = require('./middleware/orgContext.js');
const { requestIdMiddleware } = require('./middleware/requestId');
const { loggingMiddleware } = require('./middleware/logging');
const { loadConfig } = require('./config');
const { competitionsRouter } = require('./routes/competitions');
const { entriesRouter } = require('./routes/entries');
const { authRouter } = require('./routes/auth');
const { authMiddleware } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

dotenv.config({ path: '../.env' });

const app = express();
app.use(express.json());
app.use(requestIdMiddleware);
app.use(orgContextMiddleware); // header x-org-id (legacy / tests)
app.use(authMiddleware); // JWT sets req.user + orgId override
app.use(loggingMiddleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/competitions', competitionsRouter);
app.use('/auth', authRouter);
app.use('/', entriesRouter);
app.use(errorHandler);

const { PORT: port } = loadConfig();
function start() {
  return app.listen(port, () => console.log(`API listening on ${port}`));
}

module.exports = { default: app, start };
