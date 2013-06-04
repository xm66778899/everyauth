var path = require('path');
var EventEmitter = require('events').EventEmitter;
var connect = require('connect');
var express = require('express');
var __pause = connect.utils.pause;
var merge = require('./lib/utils').merge;

var everyauth = module.exports = {};


everyauth.helpExpress = function () {
  console.warn('everyauth.helpExpress is being deprecated. helpExpress is now automatically invoked when it detects express. So remove everyauth.helpExpress from your code');
  return this;
};

everyauth.debug = false;

// The connect middleware. e.g.,
//     connect(
//         ...
//       , everyauth.middleware()
//       , ...
//     )
everyauth.middleware = function (opts) {
  opts = merge({
    autoSetupRoutes: true
  }, opts);
  var userAlias = everyauth.expressHelperUserAlias || 'user';
  var pseudoApp = function (req, res, next) {
    addRequestLocals(req, res, userAlias);
    registerReqGettersAndMethods(req);
    fetchUserFromSession(req, next);
  };
  if (opts.autoSetupRoutes) {
    pseudoApp.set = true;
    pseudoApp.handle = pseudoApp;
    // An express "app" will emit the app that is mounting it on the "mount"
    // event. This is how we will get a variable that is bound to the app that is
    // using this middleware.
    pseudoApp.emit = function (event, app) {
      if (event === 'mount') {
        var modules = everyauth.enabled;
        for (var _name in modules) {
          var _module = modules[_name];
          _module.validateSequences();
          _module.routeApp(app);
        }
      }
    };
  }
  return pseudoApp;
};

function addRequestLocals (req, res, userAlias) {
  if (res.locals) {
    var session = req.session;
    var auth = session && session.auth;
    var everyauthLocal = merge(auth, {
      loggedIn: !! (auth && auth.loggedIn)
    , user: req.user
    });

    if (everyauth.enabled.password) {
      // Add in access to loginFormFieldName() + passwordFormFieldName()
      everyauthLocal.password || (everyauthLocal.password = {});
      everyauthLocal.password.loginFormFieldName = everyauth.password.loginFormFieldName();
      everyauthLocal.password.passwordFormFieldName = everyauth.password.passwordFormFieldName();
    }
    res.locals.everyauth = everyauthLocal;
    res.locals[userAlias] = req.user;
  }
}

function registerReqGettersAndMethods (req) {
  var methods = everyauth._req._methods
  var getters = everyauth._req._getters;
  for (var name in methods) {
    req[name] = methods[name];
  }
  for (name in getters) {
    Object.defineProperty(req, name, {
      get: getters[name]
    });
  }
}

function fetchUserFromSession (req, callback) {
  var session = req.session
  var auth = session && session.auth;
  if (!auth || !auth.userId) return callback();
  var everymodule = everyauth.everymodule;
  var pause = __pause(req);

  var findUserById_function = everymodule.findUserById();

  findUserById_function.length === 3
    ? findUserById_function( req, auth.userId, findUserById_callback )
    : findUserById_function(      auth.userId, findUserById_callback );

  function findUserById_callback (err, user) {
    if (err) {
      pause.resume();
      return callback(err);
    }
    if (user) req.user = user;
    else delete sess.auth;
    callback();
    pause.resume();
  }
}

// TODO Remove this implementation
everyauth.oldMiddleware = function (expressApp) {
  if (expressApp) {
    // Then decorate the parent app as soon as we mount everyauth as middleware
    // so that any views accessible from the parent app have dynamic helpers
    // related to everyauth.
    var userAlias = everyauth.expressHelperUserAlias || 'user';

    expressApp.use( function (req, res, next) {
      var sess = req.session
        , auth = sess.auth
        , ea = { loggedIn: !!(auth && auth.loggedIn) };

      // Copy the session.auth properties over
      for (var k in auth) {
        ea[k] = auth[k];
      }

      if (everyauth.enabled.password) {
        // Add in access to loginFormFieldName() + passwordFormFieldName()
        ea.password || (ea.password = {});
        ea.password.loginFormFieldName = everyauth.password.loginFormFieldName();
        ea.password.passwordFormFieldName = everyauth.password.passwordFormFieldName();
      }
      ea.user = req.user;

      res.locals.everyauth = ea;
      next();
    });

    expressApp.use( function (req, res, next) {
      res.locals[userAlias] = req.user;
      next();
    });
  }

  var app = express();
  app.use(function registerReqGettersAndMethods (req, res, next) {
      var methods = everyauth._req._methods
        , getters = everyauth._req._getters;
      for (var name in methods) {
        req[name] = methods[name];
      }
      for (name in getters) {
        Object.defineProperty(req, name, {
          get: getters[name]
        });
      }
      next();
    })
    .use(function fetchUserFromSession (req, res, next) {
      var sess = req.session
        , auth = sess && sess.auth;
      if (!auth || !auth.userId) return next();
      var everymodule = everyauth.everymodule;
      var pause = __pause(req);

      var findUserById_callback = function (err, user) {
        if (err) {
          pause.resume();
          return next(err);
        }
        if (user) req.user = user;
        else delete sess.auth;
        next();
        pause.resume();
      };

      var findUserById_function = everymodule.findUserById();

      findUserById_function.length === 3
        ? findUserById_function( req, auth.userId, findUserById_callback )
        : findUserById_function(      auth.userId, findUserById_callback );

    })
    .use(app.router)

  var modules = everyauth.enabled;
  for (var _name in modules) {
    var _module = modules[_name];
    _module.validateSequences();
    _module.routeApp(app);
  }

  app.everyauth = true;

  return app;
};

everyauth._req = {
    _methods: {}
  , _getters: {}
};

everyauth.addRequestMethod = function (name, fn) {
  this._req._methods[name] = fn;
  return this;
};

everyauth.addRequestGetter = function (name, fn, isAsync) {
  this._req._getters[name] = fn;
  return this;
};

everyauth
  .addRequestMethod('logout', function () {
    var req = this;
    delete req.session.auth;
  })
  .addRequestGetter('loggedIn', function () {
    var req = this;
    return !!(req.session && req.session.auth && req.session.auth.loggedIn);
  });

everyauth.modules = {};
everyauth.enabled = {};

// Grab all filenames in ./modules -- They correspond to the modules of the same name
// as the filename (minus '.js')
var fs = require('fs');
var files = fs.readdirSync(__dirname + '/lib/modules');
var includeModules = files.map( function (fname) {
  return path.basename(fname, '.js');
});
for (var i = 0, l = includeModules.length; i < l; i++) {
  var name = includeModules[i];

  // Lazy enabling of a module via `everyauth` getters
  // i.e., the `facebook` module is not loaded into memory
  // until `everyauth.facebook` is evaluated
  Object.defineProperty(everyauth, name, {
    get: (function (name) {
      return function () {
        var mod = this.modules[name] || (this.modules[name] = require('./lib/modules/' + name));
        // Make `everyauth` accessible from each auth strategy module
        if (!mod.everyauth) mod.everyauth = this;
        if (mod.shouldSetup)
          this.enabled[name] = mod;
        return mod;
      }
    })(name)
  });
};
