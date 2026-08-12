import { loginUser,refreshAccessToken,logoutUser } from "../services/auth.services.js";

//Login controller - Login user 
export const login = async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password is required" });
    }
    try {
        const { access_token, refresh_token } = await loginUser({ email, password });

        res.cookie('refresh_token', refresh_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite:process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({ accessToken: access_token });
    } catch (err) {
        res.status(401).json({ error: err.message }); 
    }
}

//Refresh token refreshing controller
export const refresh = async (req,res) =>{
    try{ 
        const token = req.cookies?.refresh_token;
        if(!token){
            return res.status(400).json({ error:"No refresh token"})
        }
        const { access_token,refresh_token } = await refreshAccessToken(token);
        res.cookie('refresh_token',refresh_token,{
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite:process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        })

        res.json({accessToken: access_token})
    }
    catch(err){
        res.status(500).json({ error: "Refresh error"});
    }    
}

//Logout controller - Logout of user
export const logout = async (req,res) =>{
    try{
        const token = req.cookies?.refresh_token;
        if(token) {
            try {
                await logoutUser(token);
            } catch (err) {
                console.error('Logout error:', err.message || err);
            }
        }

        res.clearCookie('refresh_token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'none'
        });
        res.status(200).json({ success : true });
    }
    catch(err){
        res.status(500).json({ error: "Error in logout "});
    }
}