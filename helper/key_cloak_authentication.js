/**
 * name : key-cloak-authentication
 * author : 
 **/
var keyCloakAuthUtils = require("keycloak-auth-utils");
const jwt = require('jsonwebtoken');
const fs = require('fs');
const config = require('../config/config');
const accessTokenValidationMode = (config.validate_access_token_offline && config.validate_access_token_offline === "OFF") ? "OFF" : "ON";
const keyCloakPublicKeyPath = (config.keycloak_public_key_path && config.keycloak_public_key_path != "") ? PROJECT_ROOT_DIRECTORY + "/" + config.keycloak_public_key_path+ "/" : PROJECT_ROOT_DIRECTORY + "/" + "keycloak-public-keys/";

function ApiInterceptor(keycloak_config, cache_config) {
  this.config = keycloak_config;
  this.keyCloakConfig = new keyCloakAuthUtils.Config(this.config);
  this.grantManager = new keyCloakAuthUtils.GrantManager(this.keyCloakConfig);

}

/**
 * [validateToken is used for validate user]
 * @param  {[string]}   token    [x-auth-token]
 * @param  {Function} callback []
 * @return {[Function]} callback [its retrun err or object with fields(token, userId)]
 */
ApiInterceptor.prototype.validateToken = function (token, callback) {

  if (accessTokenValidationMode === "ON") {
    var self = this;
    var decoded = jwt.decode(token, { complete: true });
    if (decoded === null || decoded.header === null) {
      return callback("ERR_TOKEN_INVALID", null);
    }

    const kid = decoded.header.kid
    let cert = "";
    let path = keyCloakPublicKeyPath + kid + '.pem';

    if (fs.existsSync(path)) {
      cert = fs.readFileSync(path);
      jwt.verify(token, cert, { algorithm: 'RS256' }, function (err, decode) {

        if (err) {
          return callback("ERR_TOKEN_INVALID", null);
        }

        if (decode !== undefined) {
          const expiry = decode.exp;
          const now = new Date();
          if (now.getTime() > expiry * 1000) {
            return callback('Expired', null);
          }

          self.grantManager.userInfo(token, function (err, userData) {
            if (err) {
              return callback(err, null);
            } else {
              return callback(null, { token: token, userId: userData.sub.split(":").pop() });
            }
          });

        } else {
          return callback("ERR_TOKEN_INVALID", null);
        }

      });
    } else {
      return callback("ERR_TOKEN_INVALID", null);
    }
  } else {
    var self = this;
    self.grantManager.userInfo(token, function (err, userData) {
      if (err) {
        return callback(err, null);
      } else {
        return callback(null, { token: token, userId: userData.sub.split(":").pop() });
      }
    });
  }
};

module.exports = ApiInterceptor;
