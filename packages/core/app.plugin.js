const plugin = require('./plugin/build/index.js');
module.exports = plugin.default ?? plugin;
