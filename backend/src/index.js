const express = require('express');
const dotenv = require('dotenv');
const { orgContextMiddleware } = require('./middleware/orgContext.js');

dotenv.config({ path: '../.env' });

const app = express();
app.use(express.json());
app.use(orgContextMiddleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const port = process.env.PORT || 3000;
function start() {
  return app.listen(port, () => console.log(`API listening on ${port}`));
}

module.exports = { default: app, start };
