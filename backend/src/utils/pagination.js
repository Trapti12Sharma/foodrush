function parsePagination(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 12, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function buildPaginationMeta(total, page, limit) {
  return { total, page, limit, totalPages: Math.max(Math.ceil(total / limit), 1) };
}

module.exports = { parsePagination, buildPaginationMeta };
