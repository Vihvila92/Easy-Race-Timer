function errorHandler(err, _req, res, _next) {
  if (err && err.code && typeof err.code === 'string' && err.code.startsWith('23')) {
    return res.status(422).json({ error: { code: 'CONSTRAINT_VIOLATION', message: err.message } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}

module.exports = { errorHandler };
