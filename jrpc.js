'use strict';

/**
 * Constructor
 *
 * @return {Object} New instance
 */
function JRPC() {
  this.transmitter = null;
  this.remoteTimeout = 10000;
  this.localTimeout = 5000;
  this.serial = 0;
  this.outbox = {
    requests : [],
    responses: []
  };
  this.inbox = {};
  this.localComponents = {
    'system.listComponents'      : true,
    'system.extension.dual-batch': true
  };
  this.remoteComponents = {};
  this.exposed = {};

  this.exposed.listComponents = function(params, next) {
    if (typeof params === 'object') {
      this.remoteComponents = params;
    }
    return next(null, this.components);
  };
}

// Temporarily:
/* eslint-disable no-unused-vars */

JRPC.prototype.setRemoteTimeout = function(secs) {
  if (typeof secs === 'number') {
    this.remoteTimeout = secs * 1000;
  }
};

JRPC.prototype.setLocalTimeout = function(secs) {
  if (typeof secs === 'number') {
    this.localTimeout = secs * 1000;
  }
};

// Will call next(err, result) when we receive the result or time out
JRPC.prototype.call = function(methodName, params, next) {
  var request = {
    jsonrpc: '2.0',
    method : methodName
  };

  this.serial++;
  request.id = this.serial;
  if (typeof params === 'object') {
    request.params = params;
  }

  this.inbox[this.serial] = next;
  this.outbox.requests.push(request);

  if (this.remoteTimeout > 0) {
    setTimeout(
      this._deliverResponse.bind(
        this,
        {
          jsonrpc: '2.0',
          id     : this.serial,
          error  : -1000
        }
      ),
      this.remoteTimeout
    );
  }
};

// Support Bluebird automatically if it's globally available
if (typeof Promise.promisify === 'function') {
  JRPC.prototype.callAsync = Promise.promisify(JRPC.prototype.call);
}

JRPC.prototype.expose = function(subject, callback) {
  var name;

  if (typeof subject === 'string') {
    this.localComponents[subject] = true;
    this.exposed[subject] = callback;
  } else if (typeof subject === 'object') {
    for (name in subject) {
      if (subject.hasOwnProperty(name)) {
        this.localComponents[name] = true;
        this.exposed[name] = subject[name];
      }
    }
  }
};

JRPC.prototype.receive = function(msg) {
  var requests = [];
  var responses = [];

  // If we got JSON, parse it
  if (typeof msg === 'string') {
    try {
      msg = JSON.parse(msg);
    } catch (e) {
      // The specification doesn't force us to respond in error, ignoring
      return;
    }
  }

  // If we get a standard single-type batch, dispatch it
  if (msg.constructor === Array) {
    if (msg.length === 0) {
      return;
    }
    // Hint of request batch
    if (typeof msg[0].method === 'string') {
      requests = msg;
    } else {
      responses = msg;
    }
  } else if (typeof msg === 'object') {
    // Could we be a 'dual-batch' extended message?
    if (
      typeof msg.requests !== 'undefined'
      && typeof msg.responses !== 'undefined'
    ) {
      requests = msg.requests;
      responses = msg.responses;
    } else if (typeof msg.method === 'string') {
      // We're a single request
      requests.push(msg);
    } else {
      // We must be a single response
      responses.push(msg);
    }
  }

  responses.forEach(this._deliverResponse.bind(this));
  requests.forEach(this._serveRequest.bind(this));
};

JRPC.prototype._deliverResponse = function(res) {
  var err = null;
  var result = null;

  if ('id' in res && res['id'] in this.inbox) {
    if ('error' in res) {
      err = res['error'];
    } else {
      result = res['result'];
    }
    setImmediate(this.inbox[res['id']].bind(null, err, result));
    delete this.inbox[res['id']];
  }
  // Silently ignore timeout duplicate and malformed responses
};

// method [params] [id]
JRPC.prototype._serveRequest = function(requests) {
  // Just hand off this._sendResponse.bind(this, id) to the provider
};

JRPC.prototype._sendResponse = function(id, err, result) {
  var response = {
    jsonrpc: '2.0',
    id     : id
  };

  if (typeof err !== 'undefined' && err !== null && err) {
    response.error = err;
  } else {
    response.result = result;
  }
  this.outbox.responses.push(response);
};

// Will call next(data, next)
// Expect OUR next to be called with (err) so we know if it worked
JRPC.prototype.transmit = function(callback) {
  var sender = callback || this._transmitter;
};

JRPC.prototype.setTransmitter = function(callback) {
  this.transmitter = callback;
  this.transmit();
};

module.exports = JRPC;
