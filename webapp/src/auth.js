const passport = require('passport');
const { OIDCStrategy } = require('passport-azure-ad');

const {
  AAD_TENANT_ID,
  AAD_CLIENT_ID,
  AAD_CLIENT_SECRET,
  AAD_REDIRECT_URI,
} = process.env;

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(
  new OIDCStrategy(
    {
      identityMetadata: `https://login.microsoftonline.com/${AAD_TENANT_ID}/v2.0/.well-known/openid-configuration`,
      clientID: AAD_CLIENT_ID,
      clientSecret: AAD_CLIENT_SECRET,
      responseType: 'code',
      responseMode: 'form_post',
      redirectUrl: AAD_REDIRECT_URI,
      allowHttpForRedirectUrl: process.env.NODE_ENV !== 'production',
      scope: ['profile', 'email', 'openid'],
      passReqToCallback: false,
    },
    (iss, sub, profile, accessToken, refreshToken, done) => {
      if (!profile.oid) return done(new Error('No OID in profile'), null);
      return done(null, {
        oid: profile.oid,
        name: profile.displayName,
        email: profile._json.preferred_username || profile._json.email,
      });
    }
  )
);

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  return res.redirect('/auth/login');
}

module.exports = { passport, ensureAuthenticated };
