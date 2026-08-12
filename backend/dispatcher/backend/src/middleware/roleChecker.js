export const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied. Admins only.' });
  }
  next();
};

export const requireAgentOrAdmin = (req, res, next) => {
  if (!['ADMIN', 'AGENT'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  next();
};