import jwt from 'jsonwebtoken'
import prisma from '../config/psql.js'
import bcrypt from 'bcryptjs'
import { generateAccessToken } from '../utils/tokens.js'

export const authenticate_token = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, message: "Invalid or missing authorization header" });
        }

        const token = authHeader.split(" ")[1];
        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
            if (err) {
                if (err.name === "TokenExpiredError") {
                    return res.status(401).json({
                        success: false,
                        message: "Token expired",
                        code: "TOKEN_EXPIRED"
                    })
                }
                return res.status(403).json({ success: false, message: "Invalid Token" });
            }
            req.user = decoded
            next()
        })
    } catch (err) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
}
export const cookie_validator = async (req, res, next) => {
    try {
        const token = req.cookies?.refresh_token;
        if (!token) {
            return res.status(401).json({ success: false, message: "No refresh token" })
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
        } catch (err) {
            return res.status(403).json({ success: false, message: "Invalid refresh token" });
        }

        const storedTokens = await prisma.refreshToken.findMany({
            where: {
                userId: decoded.id,
                expiresAt: { gt: new Date() }
            },
            include: { user: true }
        })

        if (!storedTokens.length) {
            return res.status(403).json({ success: false, message: "Token revoked or expired" })
        }

        let matched = null;
        for (const t of storedTokens) {
            const isMatch = await bcrypt.compare(token, t.token);
            if (isMatch) { matched = t; break; }
        }

        if (!matched) {
            return res.status(403).json({ success: false, message: "Token revoked or expired" })
        }

        req.user = matched.user
        next()

    } catch (err) {
        res.status(500).json({ success: false, message: "Server Error" })
    }
}