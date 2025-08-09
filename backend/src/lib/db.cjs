// JS bridge now points to pure JS implementation to avoid ts transform in Jest
module.exports = require('./db.js');
