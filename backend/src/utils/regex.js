// Escapes user input before it's dropped into a `new RegExp(...)`, so a search
// query like "a.*b" or "(unterminated" can't be used to build an unintended pattern.
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { escapeRegex };
