'use strict';

var coreHttpModule = require('http');

var discardUrlParameters = require('../../util/url').discardUrlParameters;
var tracingConstants = require('../constants');
var tracingUtil = require('../tracingUtil');
var cls = require('../cls');

var originalRequest = coreHttpModule.request;
var isActive = false;

exports.init = function() {
  coreHttpModule.request = function request(opts, givenResponseListener) {
    var clientRequest;

    if (!isActive || !cls.isTracing()) {
      clientRequest = originalRequest.call(coreHttpModule, opts, givenResponseListener);
      if (cls.tracingLevel()) {
        clientRequest.setHeader(tracingConstants.traceLevelHeaderName, cls.tracingLevel());
      }
      return clientRequest;
    }

    var parentSpan = cls.getCurrentSpan();

    if (cls.isExitSpan(parentSpan)) {
      clientRequest = originalRequest.call(coreHttpModule, opts, givenResponseListener);

      if (cls.tracingSuppressed()) {
        clientRequest.setHeader(tracingConstants.traceLevelHeaderName, '0');
      }
      return clientRequest;
    }

    cls.ns.run(function() {
      var span = cls.startSpan('node.http.client');

      var completeCallUrl;
      if (typeof(opts) === 'string') {
        completeCallUrl = discardUrlParameters(opts);
      } else {
        completeCallUrl = constructCompleteUrlFromOpts(opts, coreHttpModule);
      }

      span.stack = tracingUtil.getStackTrace(request);

      var responseListener = cls.ns.bind(function responseListener(res) {
        span.data = {
          http: {
            method: clientRequest.method,
            url: completeCallUrl,
            status: res.statusCode
          }
        };
        span.d = Date.now() - span.ts;
        span.error = res.statusCode >= 500;
        span.ec = span.error ? 1 : 0;
        span.transmit();

        if (givenResponseListener) {
          givenResponseListener(res);
        }
      });

      try {
        clientRequest = originalRequest.call(coreHttpModule, opts, responseListener);
      } catch (e) {
        // synchronous exceptions normally indicate failures that are not covered by the
        // listeners. Cleanup immediately.
        throw e;
      }

      cls.ns.bindEmitter(clientRequest);
      clientRequest.setHeader(tracingConstants.spanIdHeaderName, span.s);
      clientRequest.setHeader(tracingConstants.traceIdHeaderName, span.t);
      clientRequest.setHeader(tracingConstants.traceLevelHeaderName, '1');

      clientRequest.on('timeout', function() {
        span.data = {
          http: {
            method: clientRequest.method,
            url: completeCallUrl,
            error: 'Timeout exceeded'
          }
        };
        span.d = Date.now() - span.ts;
        span.error = true;
        span.ec = 1;
        span.transmit();
      });

      clientRequest.on('error', function(err) {
        span.data = {
          http: {
            method: clientRequest.method,
            url: completeCallUrl,
            error: err.message
          }
        };
        span.d = Date.now() - span.ts;
        span.error = true;
        span.ec = 1;
        span.transmit();
      });
    });
    return clientRequest;
  };
};


exports.activate = function() {
  isActive = true;
};


exports.deactivate = function() {
  isActive = false;
};

function constructCompleteUrlFromOpts(options, self) {
  if (options.href) {
    return discardUrlParameters(options.href);
  }

  try {
    var agent = options.agent || self.agent;

    var port = options.port || options.defaultPort || (agent && agent.defaultPort) || 80;
    var protocol = (port === 443 && 'https:') || options.protocol || (agent && agent.protocol) || 'http:';
    var host = options.hostname || options.host || 'localhost';
    var path = options.path || '/';
    return discardUrlParameters(protocol + '//' + host + ':' + port + path);
  } catch (e) {
    return undefined;
  }
}
