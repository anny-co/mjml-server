const timingSafeEqual = require("crypto").timingSafeEqual;
const auth = require("basic-auth");

/**
 * For two input strings, wrap them in byte buffers and compare them using a timing-attack-safe
 * strcmp function from NodeJS.crypto
 * @param input user input string
 * @param secret comparison string
 * @returns true if strings are equal, else false
 */
function safeCompare (input, secret) {
  const il = Buffer.byteLength(input);
  const sl = Buffer.byteLength(secret);

  const ib = Buffer.alloc(il, 0, "utf-8");
  ib.write(input);
  const sb = Buffer.alloc(sl, 0, "utf-8");
  sb.write(secret);

  return !!(il === sl && timingSafeEqual(ib, sb));
}

/**
 * Wraps the middleware function in a closure with its options
 *
 * @param {Record<string, unknown>} options options for middleware
 * @returns The express middlware function
 */
function makeMiddleware (options) {
  const authentication = {
    enabled: false,
    type: "none",
    basicAuth: {
      username: process.env.BASIC_AUTH_USERNAME || undefined,
      password: process.env.BASIC_AUTH_PASSWORD || undefined
    },
    token: {
      secret: process.env.AUTH_TOKEN || undefined
    },
    ...options
  };

  /**
   * Authentication middleware for supported methods of authentication
   *
   * Due to the inclusion of basic-auth, the server understands a URL format
   * https://username:password@hostname:port to contain basic authentication credentials
   * @param {express.Request} req request object
   * @param {express.Response} res response object
   * @param {express.NextFunction} next next function for passing down the middleware stack
   */
  function authMiddleware (req, res, next) {
  /**
   * HTTP Basic auth authorizer, i.e., for a pair of username and password
   * @param {string} username user-provided username
   * @param {string} password user-provided password
   * @returns true if authorized, otherwise false
   */
    function basicAuthAuthorizer (username, password) {
      return safeCompare(username, authentication.basicAuth.username) && safeCompare(password, authentication.basicAuth.password);
    }
    /**
   * Compares a user-provided token against a predefined one
   * @param {string} token authentication token
   * @returns true if authorized
   */
    function tokenAuthorizer (token) {
      return safeCompare(token, authentication.token.secret);
    }

    // authentication is not enabled, skip this middleware
    if (!authentication.enabled || authentication.type === "none") {
      next();
    }

    if (authentication.type === "basic") {
      const credentials = auth(req);

      if (!credentials || !basicAuthAuthorizer(credentials.name, credentials.pass)) {
      // Unauthenticated
        res.status(401).end();
      } else {
        next();
      }
    }

    if (authentication.type === "token") {
      const token = req.query.token || req.headers["X-Authentication-Token".toLowerCase()];
      if (!token || !tokenAuthorizer(token)) {
        res.status(401).end();
      } else {
        next();
      }
    }
  };
  return authMiddleware;
}

module.exports = makeMiddleware;
