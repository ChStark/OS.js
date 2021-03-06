/*!
 * OS.js - JavaScript Cloud/Web Desktop Platform
 *
 * Copyright (c) 2011-2016, Anders Evenrud <andersevenrud@gmail.com>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS 'AS IS' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * @author  Anders Evenrud <andersevenrud@gmail.com>
 * @licence Simplified BSD License
 */
(function(_path, _fs) {
  'use strict';

  var ignorePrivilegesAPI = ['login'];
  var ignorePrivilegesVFS = ['getMime', 'getRealPath'];

  function getSettingsPath(cfg, username) {
    if ( username === 'root' ) {
      return '/root';
    }
    return cfg.settings.replace('%USERNAME%', username);
  }

  /**
   * Internal for registering a API method. This wraps the methods so that
   * privilege checks etc are performed
   */
  function registerAPIMethod(handler, instance, fn, fref) {
    if ( !instance.api[fn] ) {
      if ( ignorePrivilegesAPI.indexOf(fn) < 0 ) {
        instance.api[fn] = function(args, callback, request, response, config, h) {
          handler.checkAPIPrivilege(request, response, fn, function(err) {
            if ( err ) {
              callback(err);
              return;
            }

            fref.apply(fref, [args, callback, request, response, config, h]);
          });
        };
      } else {
        instance.api[fn] = fref;
      }
    }
  }

  /**
   * Internal for registering a VFS method. This wraps the methods so that
   * privilege checks etc are performed
   */
  function registerVFSMethod(handler, instance, fn, fref) {
    if ( !instance.vfs[fn] ) {
      if ( ignorePrivilegesVFS.indexOf(fn) < 0 ) {
        instance.vfs[fn] = function(args, callback, request, response) {
          handler.checkAPIPrivilege(request, response, 'fs', function(err) {
            if ( err ) {
              callback(err);
              return;
            }

            handler.checkVFSPrivilege(request, response, fn, args, function(err) {
              if ( err ) {
                callback(err);
                return;
              }

              fref.apply(fref, [args, request, callback, instance.config, handler]);
            });
          });
        };
      } else {
        instance.vfs[fn] = fref;
      }
    }
  }

  /**
   * Internal for registerin lists of API method(s)
   */
  function registerMethods(handler, instance, api, vfs) {
    Object.keys(vfs || {}).forEach(function(fn) {
      registerVFSMethod(handler, instance, fn, vfs[fn]);
    });
    Object.keys(api || {}).forEach(function(fn) {
      registerAPIMethod(handler, instance, fn, api[fn]);
    });
  }

  /////////////////////////////////////////////////////////////////////////////
  // DEFAULT HANDLER
  /////////////////////////////////////////////////////////////////////////////

  /**
   * Server Handler Instance
   *
   * This is what is responsible for all API and VFS communication and user
   * session(s).
   *
   * @param   Object      instance      Current server instance
   * @param   Object      applyAPI      Apply these API methods
   * @param   Object      applyVFS      Apply these VFS methods
   *
   * @api handler.Handler
   * @class
   */
  function DefaultHandler(instance, applyAPI, applyVFS) {
    registerMethods(this, instance, applyAPI, applyVFS);
    this.instance = instance;
  }

  /**
   * Gets the username of currently active user
   *
   * @param   Object      request       Server request object
   * @param   Object      response      Server response object
   *
   * @method Handler::getUserName()
   */
  DefaultHandler.prototype.getUserName = function(request, response) {
    return request.session.get('username');
  };

  /**
   * Gets the groups of currently active user
   *
   * @param   Object      request       Server request object
   * @param   Object      response      Server response object
   *
   * @method Handler::getUserGroups()
   */
  DefaultHandler.prototype.getUserGroups = function(request, response) {
    var groups = [];
    try {
      groups = JSON.parse(request.session.get('groups'));
    } catch ( e ) {
      groups = [];
    }
    return groups;
  };

  /**
   * Gets the blacklisted packages of active user
   *
   * @param   Object      request       Server request object
   * @param   Object      response      Server response object
   * @param   Function    callback      Callback function => fn(error, result)
   *
   * @async
   * @return  void
   * @method  Handler::getUserBlacklistedPackages()
   */
  DefaultHandler.prototype.getUserBlacklistedPackages = function(request, response, callback) {
    callback(false, []);
  };

  /**
   * Sets the user data of active user
   *
   * @param   Object      request       Server request object
   * @param   Object      response      Server response object
   * @param   Object      data          Session data
   * @param   Function    callback      Callback function => fn(error, result)
   *
   * @async
   * @return void
   * @method Handler::setUserData()
   */
  DefaultHandler.prototype.setUserData = function(request, response, data, callback) {
    if ( data === null ) {
      request.session.set('username', null);
      request.session.set('groups', null);
    } else {
      request.session.set('username', data.username);
      request.session.set('groups', JSON.stringify(data.groups));
    }

    callback(false, true);
  };

  /**
   * Check if request has access to given API request
   *
   * THIS IS THE METHOD CALLED FROM THE SERVER
   *
   * @param   Object      request       Server request object
   * @param   Object      response      Server response object
   * @param   Mixed       privilege     Check against given privilege(s)
   * @param   Function    callback      Callback function => fn(err, result)
   *
   * @return  boolean                   Return true for normal, false for custom callback
   *
   * @async
   * @method Handler::checkAPIPrivilege()
   */
  DefaultHandler.prototype.checkAPIPrivilege = function(request, response, privilege, callback) {
    var self = this;
    this._checkHasSession(request, response, function(err) {
      if ( err ) {
        callback(err);
        return;
      }
      self._checkHasAPIPrivilege(request, response, privilege, callback);
    });
  };

  /**
   * Check if request has access to given VFS request
   *
   * THIS IS THE METHOD CALLED FROM THE SERVER
   *
   * @param   Object      request       Server request object
   * @param   Object      response      Server response object
   * @param   String      method        VFS Method name
   * @param   Object      args          VFS Method arguments
   * @param   Function    callback      Callback function => fn(err, result)
   *
   * @return  boolean                   Return true for normal, false for custom callback
   *
   * @async
   * @method Handler::checkVFSPrivilege()
   */
  DefaultHandler.prototype.checkVFSPrivilege = function(request, response, method, args, callback) {
    var self = this;
    this._checkHasSession(request, response, function(err) {
      if ( err ) {
        callback(err);
        return;
      }
      self._checkHasVFSPrivilege(request, response, method, args, callback);
    });
  };

  /**
   * Check if request has access to given Package
   *
   * THIS IS THE METHOD CALLED FROM THE SERVER
   *
   * @param   Object      request       Server request object
   * @param   Object      response      Server response object
   * @param   String      packageName   Name of Package (ex: repo/name)
   * @param   Function    callback      Callback function => fn(err, result)
   *
   * @return  boolean                   Return true for normal, false for custom callback
   *
   * @async
   * @method Handler::checkPackagePrivilege()
   */
  DefaultHandler.prototype.checkPackagePrivilege = function(request, response, packageName, callback) {
    var self = this;
    this._checkHasSession(request, response, function(err) {
      if ( err ) {
        callback(err);
        return;
      }
      self._checkHasPackagePrivilege(request, response, packageName, callback);
    });
  };

  /**
   * Event fired when server starts
   *
   * @async
   * @method Handler::onServerStart()
   */
  DefaultHandler.prototype.onServerStart = function(cb) {
    cb();
  };

  /**
   * Event fired when server ends
   *
   * @async
   * @method Handler::onServerEnd()
   */
  DefaultHandler.prototype.onServerEnd = function(cb) {
    cb();
  };

  /**
   * Event fired when server gets a login
   *
   * @param     Object        request       Server request object
   * @param     Object        response      Server response object
   * @param     Object        data          The login data
   * @param     Function      callback      Callback fuction
   *
   * @async
   * @method Handler::onLogin()
   */
  DefaultHandler.prototype.onLogin = function(request, response, data, callback) {
    var self = this;

    function finished() {
      if ( data.blacklistedPackages ) {
        callback(false, data);
      } else {
        self.getUserBlacklistedPackages(request, response, function(error, blacklist) {
          if ( error ) {
            callback(error);
          } else {
            data.blacklistedPackages = blacklist || [];
          }
          callback(false, data);
        });
      }
    }

    data.userSettings = data.userSettings || {};

    this.setUserData(request, response, data.userData, function() {
      finished();
    });
  };

  /**
   * Event fired when server gets a logout
   *
   * @param     Object        request       Server request object
   * @param     Object        response      Server response object
   * @param     Function      callback      Callback fuction
   *
   * @async
   * @method Handler::onLogout()
   */
  DefaultHandler.prototype.onLogout = function(request, response, callback) {
    this.setUserData(request, response, null, function() {
      callback(false, true);
    });
  };

  /**
   * Default method for checking if User has given group(s)
   *
   * If the user has group 'admin' it will automatically granted full access
   *
   * @param   Object      request       Server request object
   * @param   Object      response      Server response object
   * @param   String      groupname     Group name(s) (can also be an array)
   * @param   Function    callback      Callback function => fn(err, result)
   *
   * @return  boolean
   *
   * @async
   * @method Handler::_checkHasGroup()
   */
  DefaultHandler.prototype._checkHasGroup = function(request, response, groupnames, callback) {
    groupnames = groupnames || [];
    if ( !(groupnames instanceof Array) && groupnames ) {
      groupnames = [groupnames];
    }

    var self = this;
    var allowed = (function() {
      if ( typeof groupnames !== 'boolean' ) {
        var groups = self.getUserGroups(request, response);
        if ( groups.indexOf('admin') < 0 ) {
          var allowed = true;
          groupnames.forEach(function(p) {
            if ( groups.indexOf(p) < 0 ) {
              allowed = false;
            }
            return allowed;
          });
          return allowed;
        }
      }

      return true;
    })();

    callback(false, allowed);
  };

  /**
   * Default method for checking if user has a session
   *
   * @param   Object      request       Server request object
   * @param   Object      response      Server response object
   * @param   Function    callback      Callback function => fn(err, result)
   *
   * @async
   * @method Handler::_checkHasSession()
   */
  DefaultHandler.prototype._checkHasSession = function(request, response, callback) {
    if ( !this.instance.setup.nw && !this.getUserName(request, response) ) {
      callback('You have no OS.js Session, please log in!');
      return;
    }
    callback(false, true);
  };

  /**
   * Default method for checking blacklisted package permissions
   *
   * @param   Object      request       Server request object
   * @param   Object      response      Server response object
   * @param   String      packageName   Name of the package
   * @param   Function    callback      Callback function => fn(err, result)
   *
   * @async
   * @method Handler::_checkHasBlacklistedPackage()
   */
  DefaultHandler.prototype._checkHasBlacklistedPackage = function(request, response, packageName, callback) {
    this.getUserBlacklistedPackages(request, response, function(error, list) {
      if ( error ) {
        callback(error, false);
      } else {
        callback(false, (list || []).indexOf(packageName) >= 0);
      }
    });
  };

  /**
   * Check if active user has given API privilege
   *
   * @async
   * @see Handler::checkAPIPrivilege()
   * @method Handler::_checkHasAPIPrivilege()
   */
  DefaultHandler.prototype._checkHasAPIPrivilege = function(request, response, privilege, callback) {
    var map = this.instance.config.api.groups;
    if ( map && privilege && map[privilege] ) {
      this._checkHasGroup(request, response, privilege, function(err, res) {
        if ( !res && !err ) {
          err = 'You are not allowed to use this API function!';
        }
        callback(err, res);
      });
      return;
    }

    callback(false, true);
  };

  /**
   * Check if active user has given VFS privilege
   *
   * This method only checks for the 'mount' location. You can
   * override this to make it check for given method name as well
   *
   * @async
   * @see Handler::checkVFSPrivilege()
   * @method Handler::_checkHasVFSPrivilege()
   */
  DefaultHandler.prototype._checkHasVFSPrivilege = function(request, response, method, args, callback) {
    var mount = this.instance.vfs.getRealPath(args.path || args.src, this.instance.config, request);
    var cfg = this.instance.config.vfs.groups;
    var against;

    try {
      against = cfg[mount.protocol.replace(/\:\/\/$/, '')];
    } catch ( e ) {}

    if ( against ) {
      this._checkHasGroup(request, response, against, function(err, res) {
        if ( !res && !err ) {
          err = 'You are not allowed to use this VFS function!';
        }
        callback(err, res);
      });
      return;
    }

    callback(false, true);
  };

  /**
   * Check if active user has given Package privilege
   *
   * This method checks user groups against the ones defined in package metadata
   *
   * @async
   * @see Handler::checkPackagePrivilege()
   * @method Handler::_checkHasPackagePrivilege()
   */
  DefaultHandler.prototype._checkHasPackagePrivilege = function(request, response, packageName, callback) {
    var packages = this.instance.metadata;
    var self = this;

    function notallowed(err) {
      callback(err || 'You are not allowed to load this Package');
    }

    if ( packages && packages[packageName] && packages[packageName].groups ) {
      this._checkHasGroup(request, response, packages[packageName].groups, function(err, res) {
        if ( err ) {
          notallowed(err);
        } else {
          if ( res ) {
            self._checkHasBlacklistedPackage(request, response, packageName, function(err, res) {
              if ( err || !res ) {
                notallowed(err);
              } else {
                callback(false, true);
              }
            });
          } else {
            notallowed();
          }
        }
      });
      return;
    }

    callback(false, true);
  };

  /**
   * Perform a system-type login event.
   *
   * Used for PAM and Shadow handler.
   *
   * This method will:
   * - Fetch user settings from the home directory
   * - Get the user groups from etc file
   * - Get user-blacklisted packages from home directory
   * - Gets user-id (external event)
   *
   * @param     Object        request       Server request object
   * @param     Object        response      Server response object
   * @param     Object        cfg           The config object
   * @param     Object        login         The login object
   * @param     Function      getUserId     Function for getting userid
   * @param     Function      callback      Callback fuction
   *
   * @async
   * @method Handler::onSystemLogin()
   */
  DefaultHandler.prototype.onSystemLogin = function(request, response, cfg, login, getUserId, callback) {
    var self = this;

    function getUserGroups(cb) {
      _fs.readFile(cfg.groups, function(err, gdata) {
        var list = {};
        if ( !err ) {
          try {
            list = JSON.parse(gdata.toString());
          } catch ( e ) {}
        }

        cb(list[login.username] || []);
      });
    }

    function getUserSettings(cb) {
      _fs.readFile(getSettingsPath(cfg, login.username), function(err, sdata) {
        var settings = {};
        if ( !err && sdata ) {
          try {
            settings = JSON.parse(sdata.toString());
          } catch ( e ) {}
        }
        cb(settings);
      });
    }

    function getUserBlacklist(cb) {
      _fs.readFile(cfg.blacklist, function(err, bdata) {
        var blacklist = [];

        if ( !err && bdata ) {
          try {
            blacklist = JSON.parse(bdata)[login.username] || [];
          } catch ( e ) {}
        }

        cb(blacklist);
      });
    }

    function done(data, settings, blacklist) {
      self.onLogin(request, response, {
        userData: {
          id:       data.id,
          username: login.username,
          name:     data.name,
          groups:   data.groups
        },

        userSettings: settings,
        blacklistedPackages: blacklist
      }, callback);
    }

    getUserSettings(function(settings) {
      getUserGroups(function(groups) {
        getUserBlacklist(function(blacklist) {
          getUserId(function(uid) {
            done({
              id: uid,
              groups: groups,
              name: login.username
            }, settings, blacklist);
          });
        });
      });
    });
  };

  /**
   * Stores the user setings into the home directory of user
   *
   * @param     Object        request       Server request object
   * @param     Object        response      Server response object
   * @param     Object        cfg           The config object
   * @param     Object        settings      The settings object
   * @param     Function      getUserId     Function for getting userid
   * @param     Function      callback      Callback fuction
   *
   * @async
   * @method Handler::onSystemSettings()
   */
  DefaultHandler.prototype.onSystemSettings = function(request, response, cfg, settings, callback) {
    var uname = this.getUserName(request, response);
    var data  = JSON.stringify(settings);
    var spath = getSettingsPath(cfg, uname);

    // Make sure directory exists before writing
    _fs.mkdir(_path.dirname(spath), function() {
      _fs.writeFile(spath, data,  function(err) {
        callback(err || false, !!err);
      });
    });
  };

  /////////////////////////////////////////////////////////////////////////////
  // NW HANDLER
  /////////////////////////////////////////////////////////////////////////////

  /**
   * @api handler.NWHandler
   * @see handler.Handler
   * @class
   */
  function NWHandler(instance) {
    DefaultHandler.call(this, instance, {
      login: function(args, callback, request, response, config, handler) {
        handler.onLogin(request, response, {
          userData: {
            id: 0,
            username: 'nw',
            name: 'NW.js User',
            groups: ['admin']
          }
        }, callback);
      },
      logout: function(args, callback, request, response, config, handler) {
        handler.onLogout(request, response, callback);
      }
    });
  }

  NWHandler.prototype = Object.create(DefaultHandler.prototype);
  NWHandler.constructor = DefaultHandler;

  /////////////////////////////////////////////////////////////////////////////
  // EXPORTS
  /////////////////////////////////////////////////////////////////////////////

  /**
   * Initializes the handler
   *
   * @param   Object      instance      Current server instance
   *
   * @return  Handler
   *
   * @see osjs.js
   * @api handler.init()
   */
  module.exports.init = function(instance) {

    // Register 'handler' API methods
    var handler;

    if ( instance.setup.nw ) {
      handler = new NWHandler(instance);
    } else {
      var hs = _path.join(instance.setup.dirname, 'handlers', instance.config.handler, 'handler.js');
      if ( instance.setup.logging ) {
        console.info('+++', hs.replace(instance.setup.root, '/'));
      }
      handler = require(hs).register(instance, DefaultHandler);
    }

    registerMethods(handler, instance, instance._api, instance._vfs);

    return handler;
  };
})(require('path'), require('node-fs-extra'));
