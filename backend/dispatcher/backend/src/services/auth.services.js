import prisma from '../config/psql.js';
import bcrypt from 'bcryptjs';
import { generateAccessToken, generateRefreshToken } from '../utils/tokens.js';
import jwt from 'jsonwebtoken';

export const loginUser = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('Invalid Credentials');

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) throw new Error('Invalid Credentials');

  const access_token = generateAccessToken(user);
  const refresh_token = generateRefreshToken(user);

  const hashed = await bcrypt.hash(refresh_token, Number(process.env.SALT));
  await prisma.RefreshToken.create({
    data: {
      token: hashed,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return { access_token, refresh_token };
};
export const refreshAccessToken = async (token) => {
  const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);

  const tokens = await prisma.refreshToken.findMany({
    where: { userId: payload.id, expiresAt: { gt: new Date() } },
  });

  const matched = await Promise.all(
    tokens.map(async (t) => {
      const match = await bcrypt.compare(token, t.token);
      return match ? t : null;
    })
  ).then((results) => results.find(Boolean));

  if (!matched) throw new Error('Invalid refresh token');
  if (matched.expiresAt < new Date()) throw new Error('Refresh token expired');

  await prisma.refreshToken.deleteMany({ where: { id: matched.id } });

  const user = await prisma.user.findUnique({ where: { id: payload.id } });
  const role = payload.role || user?.role;

  const newAccessToken = generateAccessToken({ id: payload.id, email: payload.email, role });
  const newRefreshToken = generateRefreshToken({ id: payload.id, email: payload.email, role });

  const hashed = await bcrypt.hash(newRefreshToken, Number(process.env.SALT));
  await prisma.RefreshToken.create({
    data: {
      token: hashed,
      userId: payload.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return { access_token: newAccessToken, refresh_token: newRefreshToken };
};

export const logoutUser = async (token) => {
  const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);

  const tokens = await prisma.refreshToken.findMany({
    where: {
      userId: payload.id,
      expiresAt: { gt: new Date() }
    },
  });

  const matched = await Promise.all(
    tokens.map(async (t) => {
      const match = await bcrypt.compare(token, t.token);
      return match ? t : null;
    })
  ).then((results) => results.find(Boolean));

  if (matched) {
    await prisma.refreshToken.deleteMany({ where: { id: matched.id } });
  }
};