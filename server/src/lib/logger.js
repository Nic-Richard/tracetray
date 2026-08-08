const DEBUG_TRACETRAY = process.env.DEBUG_TRACETRAY === '1';

function debug(...args) {
  if (DEBUG_TRACETRAY) console.log(...args);
}

function info(...args) {
  console.log(...args);
}

function warn(...args) {
  console.warn(...args);
}

function error(...args) {
  console.error(...args);
}

module.exports = { debug, info, warn, error };
